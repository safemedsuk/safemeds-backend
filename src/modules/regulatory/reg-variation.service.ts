import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RegVariation } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateRegVariationDto } from './dto/create-reg-variation.dto'
import { RegDossierService, RegDossierWithSlots } from './reg-dossier.service'

export interface RequestMeta {
  ip?: string
}

const REG_REGISTRATION_RECORD_TYPE = 'reg_registration'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A variation is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 7 — Lifecycle: Variations & Renewals. Folds
 * a renewal into this same model as `variationType: 'renewal'`, per the
 * todo's own offered resolution, rather than a second parallel table.
 * Deliberately reuses **all** of Stage 1–6's own machinery rather than a
 * parallel one: `create()` calls the exact same `RegDossierService.create()`
 * every fresh registration uses, just with `productRegistrationId`
 * pre-set — that one pre-set value is what `RegWorkflowGuards`' own
 * status-sync function reads at `→ approved` to update the existing
 * registration instead of creating a new one (see `RegVariation`'s own
 * schema doc comment for the full reasoning). `productId`/`authorityId`/
 * `productClass`/`route` all default to the *target registration's own*
 * current values when not explicitly overridden — a variation is, by
 * default, "the same registration, revised," not a from-scratch
 * classification decision.
 *
 * **A real, deliberate two-step sequence, not one atomic transaction**:
 * the dossier is created first (`RegDossierService.create()`, its own
 * transaction — resolves the classification graph and instantiates a
 * real workflow), then this `RegVariation` wrapper row is created
 * immediately after, in a second, fast, DB-only transaction. Matches
 * this project's own established tolerance for "sequential-but-safe
 * suffices" (VigiCloud Stage 12's own PDF-generation-then-DB-write
 * split) — true single-transaction atomicity here would mean
 * duplicating `RegDossierService.create()`'s own requirement-resolution
 * and slot-population logic rather than reusing it, a worse tradeoff
 * than accepting the small, DB-error-only risk of an orphaned dossier
 * if the second step fails.
 */
@Injectable()
export class RegVariationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regDossierService: RegDossierService,
  ) {}

  async list(actor: AuthenticatedUser, productRegistrationId: string): Promise<RegVariation[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findMany({
        where: { companyId, productRegistrationId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<RegVariation & { regDossier: RegDossierWithSlots }> {
    const companyId = requireCompany(actor)
    const found = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regVariation.findFirst({
        where: { id, companyId },
        include: {
          regDossier: {
            include: {
              documentSlots: true,
              product: { select: { brandName: true } },
              authority: { select: { name: true, code: true } },
            },
          },
        },
      }),
    )
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Variation not found' })
    return found
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRegVariationDto,
    meta: RequestMeta,
  ): Promise<RegVariation & { regDossier: RegDossierWithSlots }> {
    const companyId = requireCompany(actor)

    const registration = await this.rls.runAsCompany(companyId, (tx) =>
      tx.productRegistration.findFirst({ where: { id: dto.productRegistrationId, companyId } }),
    )
    if (!registration)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Registration not found' })

    const dossier = await this.regDossierService.create(
      actor,
      {
        productId: dto.productId ?? registration.productId,
        authorityId: dto.authorityId ?? registration.authorityId,
        productClass: dto.productClass ?? registration.productClass ?? '*',
        route: dto.route,
      },
      meta,
      registration.id,
    )

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const variation = await tx.regVariation.create({
        data: {
          id: newId(),
          companyId,
          productRegistrationId: registration.id,
          variationType: dto.variationType,
          regDossierId: dossier.id,
          status: 'open',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reg_variation_created',
        recordType: REG_REGISTRATION_RECORD_TYPE,
        recordId: dossier.id,
        newValue: {
          variationId: variation.id,
          productRegistrationId: registration.id,
          variationType: dto.variationType,
        },
        ip: meta.ip,
      })

      return variation
    })

    return { ...created, regDossier: dossier }
  }
}
