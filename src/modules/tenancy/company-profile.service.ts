import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Company, CompanyMarket, Country, Prisma } from '@prisma/client'
import { randomInt } from 'crypto'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { QrCodeService } from '../../common/qr/qr-code.service'
import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { AuditService, diffForAudit } from '../audit/audit.service'
import { AddCompanyMarketDto } from './dto/add-company-market.dto'
import { SetWhatsappPhoneNumberIdDto } from './dto/set-whatsapp-phone-number-id.dto'
import { UpdateCompanyDto } from './dto/update-company.dto'

export interface RequestMeta {
  ip?: string
}

export type CompanyMarketWithCountry = CompanyMarket & { country: Country }

/** A tenant-safe URL/email fragment — lowercase, alphanumeric-and-hyphen only, matching the pattern real slugs/mailbox-local-parts use everywhere else on the web. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'No company context for this account',
    })
  }
  return actor.companyId
}

/**
 * Company profile + operating markets. `CompanyMarket` has no `isActive`/
 * status column (composite PK on companyId+countryId) — deactivating a
 * market is a real business decision (what happens to its facilities and
 * historical cases?) deliberately out of scope for this pass; only
 * activation is supported today. `homeCountryId`/`companyType` are set at
 * registration and not editable here — `name` and (RegCloud Stage 15)
 * `engagementType` are, matching the conservative scope of what a tenant
 * admin should self-serve.
 */
@Injectable()
export class CompanyProfileService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly qrCodeService: QrCodeService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async get(actor: AuthenticatedUser): Promise<Company> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) => this.findOrThrow(tx, companyId))
  }

  async update(
    actor: AuthenticatedUser,
    dto: UpdateCompanyDto,
    meta: RequestMeta,
  ): Promise<Company> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId)
      const updated = await tx.company.update({
        where: { id: companyId },
        data: {
          name: dto.name ?? existing.name,
          engagementType: dto.engagementType ?? existing.engagementType,
        },
      })
      const diff = diffForAudit(existing, updated)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'company_profile_updated',
        recordType: 'company',
        recordId: companyId,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
        ip: meta.ip,
      })

      return updated
    })
  }

  async listMarkets(actor: AuthenticatedUser): Promise<CompanyMarketWithCountry[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.companyMarket.findMany({
        where: { companyId },
        include: { country: true },
        orderBy: { activatedAt: 'asc' },
      }),
    )
  }

  async addMarket(
    actor: AuthenticatedUser,
    dto: AddCompanyMarketDto,
    meta: RequestMeta,
  ): Promise<CompanyMarketWithCountry> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.companyMarket.findUnique({
        where: { companyId_countryId: { companyId, countryId: dto.countryId } },
      })
      if (existing) {
        throw new ConflictException({
          code: 'MARKET_ALREADY_ACTIVE',
          message: 'This country is already an active market for your company',
        })
      }

      const country = await tx.country.findUnique({ where: { id: dto.countryId } })
      if (!country) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country' })
      }

      const created = await tx.companyMarket.create({
        data: { companyId, countryId: dto.countryId },
        include: { country: true },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'company_market_activated',
        recordType: 'company_market',
        recordId: `${companyId}:${dto.countryId}`,
        newValue: { countryId: dto.countryId, countryName: country.name },
        ip: meta.ip,
      })

      return created
    })
  }

  // ── VigiCloud Stage 3.2 — public reporting URL + QR ───────────────────────

  /**
   * Generates (or regenerates) this company's public case-reporting slug —
   * `{FRONTEND_URL}/report/{slug}`. Regenerating invalidates the old URL
   * immediately (the old slug simply no longer resolves to any company) —
   * a deliberate choice matching "never delete, but a slug isn't a
   * historical record the way a Case is," so an admin who suspects a slug
   * leaked can rotate it without any special "revoke" flow.
   */
  async generatePublicReportingSlug(actor: AuthenticatedUser, meta: RequestMeta): Promise<Company> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId)
      const slug = await this.generateUniqueSlug(tx, existing.name, 'publicReportingSlug')

      const updated = await tx.company.update({
        where: { id: companyId },
        data: { publicReportingSlug: slug },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'public_reporting_slug_generated',
        recordType: 'company',
        recordId: companyId,
        oldValue: { publicReportingSlug: existing.publicReportingSlug },
        newValue: { publicReportingSlug: slug },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** A print-quality PNG QR code encoding the current public reporting URL — 404s clearly if no slug has been generated yet, rather than encoding a broken URL. */
  async getPublicReportingQrCode(actor: AuthenticatedUser): Promise<Buffer> {
    const companyId = requireCompany(actor)
    const company = await this.rls.runAsCompany(companyId, (tx) => this.findOrThrow(tx, companyId))

    if (!company.publicReportingSlug) {
      throw new NotFoundException({
        code: 'NOT_CONFIGURED',
        message: 'Generate a public reporting URL first, before downloading its QR code',
      })
    }

    const url = `${this.configService.get('FRONTEND_URL', { infer: true })}/report/${company.publicReportingSlug}`
    return this.qrCodeService.generatePng(url)
  }

  // ── VigiCloud Stage 3.3 — inbound email intake address ───────────────────

  /** Generates (or regenerates) `{slug}@{EMAIL_INTAKE_DOMAIN}` — see `vg-stage3-setup.md` for the mail-forwarding setup this depends on to actually receive anything. Returns null instead of throwing when `EMAIL_INTAKE_DOMAIN` isn't configured yet, so the UI can show a clear "not set up" state rather than a 500. */
  async generateIntakeEmailAddress(actor: AuthenticatedUser, meta: RequestMeta): Promise<Company> {
    const companyId = requireCompany(actor)
    const domain = this.configService.get('EMAIL_INTAKE_DOMAIN', { infer: true })
    if (!domain) {
      throw new ConflictException({
        code: 'EMAIL_INTAKE_NOT_CONFIGURED',
        message:
          'Inbound email ingestion is not configured on this server yet — see vg-stage3-setup.md',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId)
      const localPart = await this.generateUniqueSlug(
        tx,
        existing.name,
        'intakeEmailAddress',
        (slug) => `${slug}@${domain}`,
      )

      const updated = await tx.company.update({
        where: { id: companyId },
        data: { intakeEmailAddress: localPart },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'intake_email_address_generated',
        recordType: 'company',
        recordId: companyId,
        oldValue: { intakeEmailAddress: existing.intakeEmailAddress },
        newValue: { intakeEmailAddress: localPart },
        ip: meta.ip,
      })

      return updated
    })
  }

  // ── VigiCloud Stage 3.4 — WhatsApp Business phone number ID ─────────────

  /** Meta assigns the phone number ID during WhatsApp Business Platform onboarding (outside this app) — an admin pastes it in here, matching how `R2_ACCOUNT_ID`-style vendor identifiers are always admin-supplied, never generated. */
  async setWhatsappPhoneNumberId(
    actor: AuthenticatedUser,
    dto: SetWhatsappPhoneNumberIdDto,
    meta: RequestMeta,
  ): Promise<Company> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId)
      const updated = await tx.company.update({
        where: { id: companyId },
        data: { whatsappBusinessPhoneNumberId: dto.whatsappBusinessPhoneNumberId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'whatsapp_phone_number_id_set',
        recordType: 'company',
        recordId: companyId,
        oldValue: { whatsappBusinessPhoneNumberId: existing.whatsappBusinessPhoneNumberId },
        newValue: { whatsappBusinessPhoneNumberId: dto.whatsappBusinessPhoneNumberId },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Shared by the slug/intake-email generators — tries the company's own slugified name first, falling back to appending a random suffix on collision (a shared name across tenants is entirely plausible; a raw name collision must never silently fail). `format` lets the email-address case wrap the bare slug into a full `local@domain` string before the uniqueness check, since that's what's actually stored in `intakeEmailAddress`. */
  private async generateUniqueSlug(
    tx: Prisma.TransactionClient,
    companyName: string,
    field: 'publicReportingSlug' | 'intakeEmailAddress',
    format: (slug: string) => string = (slug) => slug,
  ): Promise<string> {
    const base = slugify(companyName) || 'company'

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidateSlug = attempt === 0 ? base : `${base}-${randomInt(1000, 9999)}`
      const candidate = format(candidateSlug)
      const existing = await tx.company.findFirst({ where: { [field]: candidate } })
      if (!existing) {
        return candidate
      }
    }

    throw new Error(`Could not generate a unique ${field} after 6 attempts`)
  }

  private async findOrThrow(tx: Prisma.TransactionClient, companyId: string): Promise<Company> {
    const company = await tx.company.findUnique({ where: { id: companyId } })
    if (!company) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Company not found' })
    return company
  }
}
