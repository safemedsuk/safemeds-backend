import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ProductRegistration,
  RegPostMarketObligation,
  RegPostMarketObligationFulfillment,
} from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { CreateRegPostMarketObligationDto } from './dto/create-reg-post-market-obligation.dto'
import { FulfillRegPostMarketObligationDto } from './dto/fulfill-reg-post-market-obligation.dto'
import { ListRegPostMarketObligationsQueryDto } from './dto/list-reg-post-market-obligations-query.dto'
import { RegConfigService } from './reg-config.service'
import { addInterval } from './reg-deadline-date.util'
import { RegPostMarketObligationPdfService } from './reg-post-market-obligation-pdf.service'

export interface RequestMeta {
  ip?: string
}

export type RegPostMarketObligationWithHistory = RegPostMarketObligation & {
  fulfillments: RegPostMarketObligationFulfillment[]
}

export const REG_POST_MARKET_OBLIGATION_RECORD_TYPE = 'reg_post_market_obligation'

/**
 * Obligation types with their own dedicated handling elsewhere in
 * RegCloud — never generically tracked as a Stage 8 `RegPostMarketObligation`
 * even though they share the same `RegDeadlineRule.obligationType` natural
 * key namespace. `ensureObligationsForRegistration()` skips these so it
 * never double-tracks a rule `RegWorkflowGuards`/`RegQueryService`/
 * `PersonnelLicenceService`/`ImportExportPermitService` already own.
 */
export const RESERVED_OBLIGATION_TYPES = new Set([
  'renewal',
  'query_response',
  'facility_licence_renewal',
  'personnel_licence_renewal',
  'import_export_permit_renewal',
])

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Post-market obligations are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 8 — Post-Market & Obligations. Tracks a
 * registration's own recurring compliance cycles (annual reports,
 * periodic safety-and-quality updates) as a direct ledger — see
 * `RegPostMarketObligation.dueAt`'s own schema doc comment for why this
 * doesn't route through the shared `RegDeadline` table the way renewal/
 * query-response deadlines do. `RegDeadlineRule` (Stage 0.4) is still the
 * real cadence *source*: whatever obligation types a platform admin
 * configures and activates there are the only ones this service will
 * ever create rows for — nothing is hardcoded.
 */
@Injectable()
export class RegPostMarketObligationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regConfigService: RegConfigService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: RegPostMarketObligationPdfService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRegPostMarketObligationsQueryDto,
  ): Promise<PaginatedResult<RegPostMarketObligationWithHistory>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.productRegistrationId
          ? { productRegistrationId: query.productRegistrationId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.regPostMarketObligation.findMany({
          where,
          include: { fulfillments: { orderBy: { fulfilledAt: 'desc' } } },
          orderBy: { dueAt: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.regPostMarketObligation.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RegPostMarketObligationWithHistory> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const obligation = await tx.regPostMarketObligation.findFirst({
        where: { id, companyId },
        include: { fulfillments: { orderBy: { fulfilledAt: 'desc' } } },
      })
      if (!obligation)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Obligation not found' })
      return obligation
    })
  }

  /** Manual "log an obligation" path — mirrors `RegFeeLedgerService.createInvoice()`'s own manual-entry precedent, for a compliance obligation the country rule-set graph doesn't have configured yet. */
  async create(
    actor: AuthenticatedUser,
    dto: CreateRegPostMarketObligationDto,
    meta: RequestMeta,
  ): Promise<RegPostMarketObligation> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const registration = await tx.productRegistration.findFirst({
        where: { id: dto.productRegistrationId, companyId },
      })
      if (!registration)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Product registration not found',
        })

      const existing = await tx.regPostMarketObligation.findUnique({
        where: {
          productRegistrationId_obligationType: {
            productRegistrationId: dto.productRegistrationId,
            obligationType: dto.obligationType,
          },
        },
      })
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_TRACKED',
          message: 'This registration is already tracking an obligation of this type.',
        })
      }

      const authority = await tx.regulatoryAuthority.findUnique({
        where: { id: registration.authorityId },
      })
      const rule = authority
        ? await this.regConfigService.resolveDeadlineRule(
            authority.countryId,
            registration.authorityId,
            registration.productClass ?? '*',
            dto.obligationType,
          )
        : null

      const dueAt = rule
        ? addInterval(
            registration.issuedOn,
            rule.intervalValue,
            rule.intervalUnit as 'days' | 'months' | 'years',
          )
        : dto.dueAt
          ? new Date(dto.dueAt)
          : null
      if (!dueAt) {
        throw new ConflictException({
          code: 'DUE_DATE_REQUIRED',
          message:
            'No active deadline rule is configured for this obligation type — provide an initial due date manually, or configure and activate a rule first.',
        })
      }

      const created = await tx.regPostMarketObligation.create({
        data: {
          id: newId(),
          companyId,
          productRegistrationId: dto.productRegistrationId,
          obligationType: dto.obligationType,
          dueAt,
          status: 'pending',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_post_market_obligation_created',
        recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          productRegistrationId: dto.productRegistrationId,
          obligationType: dto.obligationType,
          dueAt: dueAt.toISOString(),
        },
        ip: meta.ip,
      })

      return created
    })
  }

  /**
   * Fulfilling the current cycle either (a) rolls the same row forward to
   * the next cycle (a resolvable rule still exists — the common,
   * self-sustaining case) or (b) leaves it `fulfilled` with nothing
   * further to track (the rule was deactivated/never existed) — an
   * honest terminal state, not a guessed-at next date.
   */
  async fulfill(
    actor: AuthenticatedUser,
    id: string,
    dto: FulfillRegPostMarketObligationDto,
    meta: RequestMeta,
  ): Promise<RegPostMarketObligationWithHistory> {
    const companyId = requireCompany(actor)

    const obligation = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regPostMarketObligation.findFirst({
        where: { id, companyId },
        include: { productRegistration: true },
      }),
    )
    if (!obligation)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Obligation not found' })

    let generatedReportId: string | undefined
    if (dto.generateFilingRecord) {
      generatedReportId = await this.generateFilingRecord(
        actor,
        obligation,
        obligation.productRegistration,
        dto.note ?? null,
        meta,
      )
    }

    const fulfilledAt = new Date()

    return this.rls.runAsCompany(companyId, async (tx) => {
      await tx.regPostMarketObligationFulfillment.create({
        data: {
          id: newId(),
          obligationId: id,
          fulfilledAt,
          fulfilledBy: actor.sub,
          evidenceDocumentId: dto.evidenceDocumentId,
          generatedReportId,
          note: dto.note,
        },
      })

      const registration = obligation.productRegistration
      const authority = await tx.regulatoryAuthority.findUnique({
        where: { id: registration.authorityId },
      })
      const rule = authority
        ? await this.regConfigService.resolveDeadlineRule(
            authority.countryId,
            registration.authorityId,
            registration.productClass ?? '*',
            obligation.obligationType,
          )
        : null

      const nextDueAt = rule
        ? addInterval(
            fulfilledAt,
            rule.intervalValue,
            rule.intervalUnit as 'days' | 'months' | 'years',
          )
        : null

      const updated = await tx.regPostMarketObligation.update({
        where: { id },
        data: nextDueAt
          ? { dueAt: nextDueAt, status: 'pending', notifiedOverdueAt: null }
          : { status: 'fulfilled' },
        include: { fulfillments: { orderBy: { fulfilledAt: 'desc' } } },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_post_market_obligation_fulfilled',
        recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
        recordId: id,
        newValue: {
          fulfilledAt: fulfilledAt.toISOString(),
          nextDueAt: nextDueAt?.toISOString() ?? null,
          evidenceDocumentId: dto.evidenceDocumentId,
          generatedReportId,
        },
        ip: meta.ip,
      })

      return updated
    })
  }

  private async generateFilingRecord(
    actor: AuthenticatedUser,
    obligation: RegPostMarketObligation,
    registration: ProductRegistration,
    note: string | null,
    meta: RequestMeta,
  ): Promise<string> {
    const companyId = requireCompany(actor)
    const { companyName, productBrandName, authorityName, lastFulfilledAt } =
      await this.rls.runAsCompany(companyId, async (tx) => {
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
        const product = await tx.product.findUniqueOrThrow({
          where: { id: registration.productId },
        })
        const authority = await tx.regulatoryAuthority.findUniqueOrThrow({
          where: { id: registration.authorityId },
        })
        const lastFulfillment = await tx.regPostMarketObligationFulfillment.findFirst({
          where: { obligationId: obligation.id },
          orderBy: { fulfilledAt: 'desc' },
        })
        return {
          companyName: company.name,
          productBrandName: product.brandName,
          authorityName: authority.name,
          lastFulfilledAt: lastFulfillment?.fulfilledAt ?? null,
        }
      })

    const fulfilledAt = new Date()
    const pdf = await this.pdfService.render({
      companyName,
      productBrandName,
      registrationNumber: registration.registrationNumber,
      authorityName,
      obligationType: obligation.obligationType,
      periodStart: lastFulfilledAt,
      periodEnd: fulfilledAt,
      fulfilledAt,
      fulfilledByName: (
        await this.rls.runAsCompany(companyId, (tx) =>
          tx.user.findUniqueOrThrow({ where: { id: actor.sub } }),
        )
      ).fullName,
      note,
    })

    const reportId = newId()
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `obligation-filing-record-${obligation.id}.pdf`,
      mimetype: 'application/pdf',
    }
    const upload = await this.documentsService.uploadDirect(
      actor,
      REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
      obligation.id,
      pdfFile,
      { title: 'Filing Record' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'regcloud',
          reportTypeKey: 'post_market_obligation_filing_record',
          title: `Post-Market Obligation Filing Record — ${obligation.obligationType}`,
          recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
          recordId: obligation.id,
          status: 'submitted',
          submittedAt: fulfilledAt,
          generatedBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_post_market_obligation_filing_record_generated',
        recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
        recordId: obligation.id,
        newValue: { reportId: report.id, documentId: upload.document.id },
      })
      return report.id
    })
  }

  /**
   * The one live, automatic trigger this pass wires — called from
   * `MasterDataService.createRegistration()`/`.updateRegistration()` and
   * from `RegWorkflowGuards`' own approval sync function, deliberately
   * parallel to `RegDeadlineService.computeOrRecompute()`/
   * `RegFeeLedgerService.createApplicationFeeInvoiceOnRegistration()`.
   * Idempotent create-only — never touches an obligation that already
   * exists (its own cadence/history is its own, once started), so it's
   * always safe to call again (e.g. the daily backfill sweep below,
   * picking up a newly-activated rule for a registration created before
   * that rule existed).
   */
  async ensureObligationsForRegistration(
    companyId: string,
    registration: ProductRegistration,
    actorUserId: string | null,
  ): Promise<void> {
    await this.rls.runAsCompany(companyId, async (tx) => {
      const authority = await tx.regulatoryAuthority.findUnique({
        where: { id: registration.authorityId },
      })
      if (!authority) return

      const rules = await this.regConfigService.listActiveDeadlineRulesByObligationType(
        authority.countryId,
        registration.authorityId,
        registration.productClass ?? '*',
      )
      for (const rule of rules) {
        if (RESERVED_OBLIGATION_TYPES.has(rule.obligationType)) continue

        const existing = await tx.regPostMarketObligation.findUnique({
          where: {
            productRegistrationId_obligationType: {
              productRegistrationId: registration.id,
              obligationType: rule.obligationType,
            },
          },
        })
        if (existing) continue

        const dueAt = addInterval(
          registration.issuedOn,
          rule.intervalValue,
          rule.intervalUnit as 'days' | 'months' | 'years',
        )
        const created = await tx.regPostMarketObligation.create({
          data: {
            id: newId(),
            companyId,
            productRegistrationId: registration.id,
            obligationType: rule.obligationType,
            dueAt,
            status: 'pending',
            createdBy: actorUserId,
          },
        })

        await this.auditService.log(tx, {
          companyId,
          actorUserId: actorUserId ?? undefined,
          actorType: actorUserId ? 'user' : 'system',
          action: 'reg_post_market_obligation_auto_created',
          recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
          recordId: created.id,
          newValue: {
            productRegistrationId: registration.id,
            obligationType: rule.obligationType,
            dueAt: dueAt.toISOString(),
          },
        })
      }
    })
  }

  /** Daily backfill — picks up a newly-activated `RegDeadlineRule` for every already-active registration, since `ensureObligationsForRegistration()` otherwise only ever runs at registration create/update time. */
  async backfillAllActiveRegistrations(): Promise<{ scanned: number; created: number }> {
    const registrations = await this.rls.runWithSystemAccess((tx) =>
      tx.productRegistration.findMany({ where: { status: 'active' } }),
    )
    let created = 0
    for (const registration of registrations) {
      const before = await this.rls.runWithSystemAccess((tx) =>
        tx.regPostMarketObligation.count({ where: { productRegistrationId: registration.id } }),
      )
      await this.ensureObligationsForRegistration(registration.companyId, registration, null)
      const after = await this.rls.runWithSystemAccess((tx) =>
        tx.regPostMarketObligation.count({ where: { productRegistrationId: registration.id } }),
      )
      created += after - before
    }
    return { scanned: registrations.length, created }
  }

  /** The daily sweep's overdue half — flip a `pending` obligation past its due date to `overdue`, exactly once, and escalate. Mirrors `RegFeeLedgerService.scanAndFlagOverdue()`'s own shape precisely. */
  async scanAndFlagOverdue(): Promise<{ flagged: number }> {
    const now = new Date()
    const overdue = await this.rls.runWithSystemAccess((tx) =>
      tx.regPostMarketObligation.findMany({
        where: { status: 'pending', dueAt: { lt: now }, notifiedOverdueAt: null },
        include: { productRegistration: true },
      }),
    )

    for (const obligation of overdue) {
      await this.rls.runAsCompany(obligation.companyId, async (tx) => {
        await tx.regPostMarketObligation.update({
          where: { id: obligation.id },
          data: { status: 'overdue', notifiedOverdueAt: now },
        })
        await this.auditService.log(tx, {
          companyId: obligation.companyId,
          actorType: 'system',
          action: 'reg_post_market_obligation_overdue',
          recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
          recordId: obligation.id,
          newValue: {
            dueAt: obligation.dueAt.toISOString(),
            obligationType: obligation.obligationType,
          },
        })
      })

      const title = `Post-market obligation overdue: ${obligation.obligationType.replace(/_/g, ' ')} (registration ${obligation.productRegistration.registrationNumber}), due ${obligation.dueAt.toISOString().slice(0, 10)}`
      await this.tasksService.escalateForRecord(
        obligation.companyId,
        REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
        obligation.id,
        'overdue',
        title,
        {},
      )

      const recipients = await this.rls.runAsCompany(obligation.companyId, (tx) =>
        tx.user.findMany({
          where: {
            companyId: obligation.companyId,
            roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' },
            status: 'active',
          },
          select: { id: true, email: true },
        }),
      )
      for (const recipient of recipients) {
        await this.notificationsService.create({
          companyId: obligation.companyId,
          userId: recipient.id,
          category: 'deadline_breached',
          title,
          body: `${title}. Obligation ${obligation.id}.`,
          type: 'post_market_obligation_overdue',
          params: {
            obligationType: obligation.obligationType.replace(/_/g, ' '),
            registrationNumber: obligation.productRegistration.registrationNumber,
            dueDate: obligation.dueAt.toISOString().slice(0, 10),
            obligationId: obligation.id,
          },
          recordType: REG_POST_MARKET_OBLIGATION_RECORD_TYPE,
          recordId: obligation.id,
        })
      }
    }

    return { flagged: overdue.length }
  }
}
