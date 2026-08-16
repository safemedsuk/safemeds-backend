import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { Entitlement } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { GrantEntitlementDto } from './dto/grant-entitlement.dto'
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface CompanySummary {
  id: string
  name: string
  companyType: string
  status: string
  homeCountryName: string
  homeCountryIsoCode: string
}

/** The sentinel used for a module-level (not feature-specific) row — see the `Entitlement` model's own doc comment for why this is never `null`. */
export const MODULE_LEVEL_FEATURE_KEY = '*'

/**
 * VigiCloud Stage 0.5 — "the monetisation layer; gates paid provisioning."
 * Company-facing reads (`listMine`) run under the caller's own tenant RLS
 * context, same as every other tenant service. Platform-side reads/writes
 * (`listForCompany`, `grant`) are genuinely cross-tenant, so they go
 * through `RlsService.runWithPlatformAccess` — structurally audited,
 * never a silent bypass.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  /** Checked by `EntitlementGuard` on every `@RequireEntitlement()`-gated route, and callable directly by any future service. */
  async isEnabled(
    companyId: string,
    moduleKey: string,
    featureKey: string = MODULE_LEVEL_FEATURE_KEY,
  ): Promise<boolean> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      if (featureKey !== MODULE_LEVEL_FEATURE_KEY) {
        const exact = await tx.entitlement.findUnique({
          where: { companyId_moduleKey_featureKey: { companyId, moduleKey, featureKey } },
        })
        if (exact) {
          return exact.enabled
        }
      }

      const moduleLevel = await tx.entitlement.findUnique({
        where: {
          companyId_moduleKey_featureKey: {
            companyId,
            moduleKey,
            featureKey: MODULE_LEVEL_FEATURE_KEY,
          },
        },
      })
      return moduleLevel?.enabled ?? false
    })
  }

  async listMine(actor: AuthenticatedUser): Promise<Entitlement[]> {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No company context for this account',
      })
    }
    return this.rls.runAsCompany(actor.companyId, (tx) =>
      tx.entitlement.findMany({
        where: { companyId: actor.companyId! },
        orderBy: [{ moduleKey: 'asc' }, { featureKey: 'asc' }],
      }),
    )
  }

  async listCompanies(query: ListCompaniesQueryDto): Promise<PaginatedResult<CompanySummary>> {
    return this.rls.runWithSystemAccess(async (tx) => {
      const where = query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}

      const [rows, total] = await Promise.all([
        tx.company.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            name: true,
            companyType: true,
            status: true,
            homeCountry: { select: { name: true, isoCode: true } },
          },
        }),
        tx.company.count({ where }),
      ])

      const summaries: CompanySummary[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        companyType: row.companyType,
        status: row.status,
        homeCountryName: row.homeCountry.name,
        homeCountryIsoCode: row.homeCountry.isoCode,
      }))

      return paginate(summaries, total, query)
    })
  }

  async listForCompany(actorUserId: string, companyId: string): Promise<Entitlement[]> {
    return this.rls.runWithPlatformAccess(
      actorUserId,
      `List entitlements for company ${companyId}`,
      (tx) =>
        tx.entitlement.findMany({
          where: { companyId },
          orderBy: [{ moduleKey: 'asc' }, { featureKey: 'asc' }],
        }),
    )
  }

  /**
   * VigiCloud Stage 16.1 — "before a company's VigiCloud entitlement is
   * switched on, a PSMF record must exist" (a Tier 0 onboarding gate, per
   * GUD/006 §2.1/§4.1). Scoped narrowly: only the module-level
   * `moduleKey: 'vigicloud'` switch-on itself is gated, not a
   * feature-level toggle within an already-on module, and not a
   * disable — there is no pluggable extension point for this the way
   * `WorkflowGuardRegistryService` exists for the workflow engine (see
   * `PsmfModule`'s own doc comment for why this is a direct, inline
   * check rather than a new generic registry for a single call site).
   * Deliberately non-retroactive: this only fires on a fresh `grant()`
   * call, never re-validates an already-enabled entitlement.
   */
  async grant(
    actorUserId: string,
    companyId: string,
    dto: GrantEntitlementDto,
    meta: RequestMeta,
  ): Promise<Entitlement> {
    const featureKey = dto.featureKey ?? MODULE_LEVEL_FEATURE_KEY

    return this.rls.runWithPlatformAccess(
      actorUserId,
      `Grant entitlement for company ${companyId}`,
      async (tx) => {
        if (
          dto.moduleKey === 'vigicloud' &&
          featureKey === MODULE_LEVEL_FEATURE_KEY &&
          dto.enabled
        ) {
          const activePsmf = await tx.psmf.findFirst({ where: { companyId, status: 'active' } })
          if (!activePsmf) {
            throw new ConflictException({
              code: 'PSMF_REQUIRED',
              message:
                'This company needs an active PSMF (Pharmacovigilance System Master File) before its VigiCloud module access can be switched on — create or upload one, then activate it. This gates only the platform-side access toggle for this company; VigiCloud itself is already built.',
            })
          }
        }

        const existing = await tx.entitlement.findUnique({
          where: {
            companyId_moduleKey_featureKey: { companyId, moduleKey: dto.moduleKey, featureKey },
          },
        })

        const result = await tx.entitlement.upsert({
          where: {
            companyId_moduleKey_featureKey: { companyId, moduleKey: dto.moduleKey, featureKey },
          },
          create: {
            id: newId(),
            companyId,
            moduleKey: dto.moduleKey,
            featureKey,
            enabled: dto.enabled,
            grantedBy: actorUserId,
          },
          update: { enabled: dto.enabled, grantedBy: actorUserId },
        })

        await this.auditService.log(tx, {
          companyId,
          actorUserId,
          action: 'entitlement_granted',
          recordType: 'entitlement',
          recordId: result.id,
          oldValue: existing ? { enabled: existing.enabled } : undefined,
          newValue: { moduleKey: dto.moduleKey, featureKey, enabled: dto.enabled },
          ip: meta.ip,
        })

        return result
      },
    )
  }
}
