import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { CaseDistributorMapping, Prisma, ReconciliationReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RolesService } from '../roles/roles.service'
import { DISTRIBUTOR_RECORD_TYPE } from './distributor.service'
import { GenerateReconciliationReportDto } from './dto/generate-reconciliation-report.dto'
import { ManuallyReconcileCaseDto } from './dto/manually-reconcile-case.dto'

export interface RequestMeta {
  ip?: string
}

export const RECONCILIATION_REPORT_RECORD_TYPE = 'reconciliation_report'

export interface DistributorBreakdown {
  distributorId: string
  distributorName: string
  caseCount: number
  caseIds: string[]
}

export interface UnmatchedCaseSummary {
  caseId: string
  referenceNumber: string
  reporterOrganization: string | null
  receivedDate: Date
}

export interface CrossTenantSummary {
  distributorId: string
  distributorCompanyId: string
  periodStart: Date
  periodEnd: Date
  /** The manufacturer's own count of cases resolved (auto or manual) to this distributor in the period. */
  manufacturerMatchedCaseCount: number
  /** A controlled, audited read of the distributor's *own* tenant data — just a count of the PV cases *they* captured in the same period, never full case content. */
  distributorTenantCaseCount: number
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Reconciliation is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * VigiCloud Stage 15.1 — reconciliation. The core mechanic: every case's
 * `Reporter.organization` (free text, typed by whoever captured it) is
 * compared, case-insensitively and trimmed, against the company's own
 * listed `Distributor` names — a clean match is resolved *live*, on
 * every report generation, never persisted redundantly. A
 * `CaseDistributorMapping` row only ever exists for a case that needed a
 * human's attention: no clean auto-match (a typo, a variant spelling, no
 * organization typed at all) or a deliberate manual override. This is
 * the honest, buildable reading of "reports come to the manufacturer,
 * they need to map it to a distributor" — real data-quality
 * reconciliation, not a claim that this system can somehow know about a
 * case a distributor never actually entered into SafeMeds at all.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  private async requireReadAccess(actor: AuthenticatedUser): Promise<void> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (
      permissions.has('reconciliation.view') ||
      permissions.has('reconciliation.manage') ||
      permissions.has('records.view_all')
    ) {
      return
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view reconciliation data',
    })
  }

  /**
   * Resolves every case in `[periodStart, periodEnd]` (by `receivedDate`)
   * into exactly one bucket: a persisted manual mapping (including a
   * deliberate "confirmed not distributor-sourced" null), a live
   * auto-match against a listed distributor's name, or genuinely
   * unmatched. Shared by `generateReport()` and `listUnmatched()` so
   * both always agree on what "unmatched" means.
   */
  private async resolveCaseDistributors(
    tx: Prisma.TransactionClient,
    companyId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{
    byDistributor: Map<string, DistributorBreakdown>
    unmatched: UnmatchedCaseSummary[]
  }> {
    const [cases, distributors, mappings] = await Promise.all([
      tx.case.findMany({
        where: { companyId, receivedDate: { gte: periodStart, lte: periodEnd } },
        include: { reporter: true },
      }),
      tx.distributor.findMany({ where: { companyId, status: 'active' } }),
      tx.caseDistributorMapping.findMany({ where: { companyId } }),
    ])

    const distributorByNormalizedName = new Map(
      distributors.map((d) => [normalize(d.name), d] as const),
    )
    const distributorById = new Map(distributors.map((d) => [d.id, d] as const))
    const mappingByCaseId = new Map(mappings.map((m) => [m.caseId, m] as const))

    const byDistributor = new Map<string, DistributorBreakdown>()
    const unmatched: UnmatchedCaseSummary[] = []

    const addToDistributor = (distributorId: string, caseId: string) => {
      const distributor = distributorById.get(distributorId)
      if (!distributor) return // a manual mapping can reference a since-deactivated/renamed distributor row that no longer resolves — treat as unmatched via the caller's own fallback, not a crash.
      const existing = byDistributor.get(distributorId) ?? {
        distributorId,
        distributorName: distributor.name,
        caseCount: 0,
        caseIds: [],
      }
      existing.caseCount += 1
      existing.caseIds.push(caseId)
      byDistributor.set(distributorId, existing)
    }

    for (const c of cases) {
      const mapping = mappingByCaseId.get(c.id)
      if (mapping) {
        if (mapping.distributorId && distributorById.has(mapping.distributorId)) {
          addToDistributor(mapping.distributorId, c.id)
        }
        // A mapping with `distributorId: null` is a confirmed "not distributor-sourced" — deliberately excluded from both buckets, not counted as unmatched (a human already looked at it).
        continue
      }

      const org = c.reporter?.organization
      const autoMatch = org ? distributorByNormalizedName.get(normalize(org)) : undefined
      if (autoMatch) {
        addToDistributor(autoMatch.id, c.id)
      } else {
        unmatched.push({
          caseId: c.id,
          referenceNumber: c.referenceNumber,
          reporterOrganization: org ?? null,
          receivedDate: c.receivedDate,
        })
      }
    }

    return { byDistributor, unmatched }
  }

  /** The unmatched-case queue a human works through — real reuse of the exact same resolution logic `generateReport()` uses, so the queue and the report can never silently disagree. */
  async listUnmatched(
    actor: AuthenticatedUser,
    periodStart: string,
    periodEnd: string,
  ): Promise<UnmatchedCaseSummary[]> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const { unmatched } = await this.resolveCaseDistributors(
        tx,
        companyId,
        new Date(periodStart),
        new Date(periodEnd),
      )
      return unmatched.sort((a, b) => b.receivedDate.getTime() - a.receivedDate.getTime())
    })
  }

  async manuallyReconcileCase(
    actor: AuthenticatedUser,
    caseId: string,
    dto: ManuallyReconcileCaseDto,
    meta: RequestMeta,
  ): Promise<CaseDistributorMapping> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const pvCase = await tx.case.findFirst({ where: { id: caseId, companyId } })
      if (!pvCase) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }
      if (dto.distributorId) {
        const distributor = await tx.distributor.findFirst({
          where: { id: dto.distributorId, companyId },
        })
        if (!distributor) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
        }
      }

      const existing = await tx.caseDistributorMapping.findUnique({ where: { caseId } })
      const data = {
        companyId,
        caseId,
        distributorId: dto.distributorId ?? null,
        reconciledBy: actor.sub,
        reconciledAt: new Date(),
        note: dto.note ?? null,
      }

      const result = existing
        ? await tx.caseDistributorMapping.update({ where: { caseId }, data })
        : await tx.caseDistributorMapping.create({ data: { id: newId(), ...data } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'case_distributor_reconciled',
        recordType: 'pv_case',
        recordId: caseId,
        oldValue: existing ? { distributorId: existing.distributorId } : undefined,
        newValue: { distributorId: dto.distributorId ?? null },
        ip: meta.ip,
      })

      return result
    })
  }

  /** "Archived and auditable" — a report is a point-in-time snapshot, never mutated after generation; re-run it for an updated picture, don't expect this one to change underneath you. */
  async generateReport(
    actor: AuthenticatedUser,
    dto: GenerateReconciliationReportDto,
    meta: RequestMeta,
  ): Promise<ReconciliationReport> {
    const companyId = requireCompany(actor)
    const periodStart = new Date(dto.periodStart)
    const periodEnd = new Date(dto.periodEnd)

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.distributorId) {
        const distributor = await tx.distributor.findFirst({
          where: { id: dto.distributorId, companyId },
        })
        if (!distributor) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
        }
      }

      const { byDistributor, unmatched } = await this.resolveCaseDistributors(
        tx,
        companyId,
        periodStart,
        periodEnd,
      )

      const breakdown = dto.distributorId
        ? [...byDistributor.values()].filter((d) => d.distributorId === dto.distributorId)
        : [...byDistributor.values()]
      const matchedCases = breakdown.reduce((sum, d) => sum + d.caseCount, 0)
      const unmatchedForReport = dto.distributorId ? [] : unmatched
      const totalCases = matchedCases + unmatchedForReport.length

      const created = await tx.reconciliationReport.create({
        data: {
          id: newId(),
          companyId,
          distributorId: dto.distributorId ?? null,
          periodStart,
          periodEnd,
          totalCases,
          matchedCases,
          unmatchedCases: unmatchedForReport.length,
          snapshot: {
            byDistributor: breakdown,
            unmatched: unmatchedForReport,
          } as unknown as Prisma.InputJsonValue,
          generatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reconciliation_report_generated',
        recordType: RECONCILIATION_REPORT_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          distributorId: dto.distributorId ?? null,
          totalCases,
          matchedCases,
          unmatchedCases: unmatchedForReport.length,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async listReports(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ReconciliationReport>> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.reconciliationReport.findMany({
          where,
          orderBy: { generatedAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.reconciliationReport.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async getReport(actor: AuthenticatedUser, id: string): Promise<ReconciliationReport> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.reconciliationReport.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reconciliation report not found',
        })
      }
      return found
    })
  }

  /**
   * VigiCloud Stage 15.1 — "where both a manufacturer and its
   * distributor are SafeMeds tenants, auto-reconcile across the two
   * tenants (a controlled, audited cross-tenant read — reuses the base
   * engine's `withPlatformAccess`-style pattern, not an ad hoc RLS
   * bypass)." Only ever runs when a platform staff member has already
   * verified and linked `Distributor.distributorCompanyId` (see
   * `DistributorService.linkTenant()`) — that link is the "controlled"
   * half. The read itself is deliberately narrow: a plain count of the
   * distributor tenant's own PV cases in the period, never full case
   * content, and it is audited **on both sides** — the manufacturer's
   * own audit trail records the read it performed, and the distributor
   * tenant's own audit trail independently records that its data was
   * read, so this is never a silent, one-sided lookup.
   */
  async crossTenantSummary(
    actor: AuthenticatedUser,
    distributorId: string,
    periodStartStr: string,
    periodEndStr: string,
  ): Promise<CrossTenantSummary> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)
    const periodStart = new Date(periodStartStr)
    const periodEnd = new Date(periodEndStr)

    const distributor = await this.rls.runAsCompany(companyId, (tx) =>
      tx.distributor.findFirst({ where: { id: distributorId, companyId } }),
    )
    if (!distributor) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
    }
    if (!distributor.distributorCompanyId) {
      throw new ForbiddenException({
        code: 'NOT_LINKED',
        message:
          'This distributor is not linked to a real SafeMeds tenant — cross-tenant reconciliation is unavailable. Ask SafeMeds staff to verify and link it first.',
      })
    }
    const distributorCompanyId = distributor.distributorCompanyId

    const { byDistributor } = await this.rls.runAsCompany(companyId, (tx) =>
      this.resolveCaseDistributors(tx, companyId, periodStart, periodEnd),
    )
    const manufacturerMatchedCaseCount = byDistributor.get(distributorId)?.caseCount ?? 0

    // The narrow, controlled cross-tenant read: a count only, scoped
    // explicitly to the distributor's own companyId — `runWithSystemAccess`
    // is what makes the bypass possible, but the application logic here
    // (not the caller) is what constrains it to exactly this one count.
    const distributorTenantCaseCount = await this.rls.runWithSystemAccess((tx) =>
      tx.case.count({
        where: {
          companyId: distributorCompanyId,
          receivedDate: { gte: periodStart, lte: periodEnd },
        },
      }),
    )

    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'reconciliation_cross_tenant_read',
        recordType: DISTRIBUTOR_RECORD_TYPE,
        recordId: distributorId,
        newValue: {
          distributorCompanyId,
          periodStart: periodStartStr,
          periodEnd: periodEndStr,
          distributorTenantCaseCount,
        },
      }),
    )
    // Independently audited on the distributor tenant's own side too — this must never be a one-sided, silent read of their data.
    await this.rls.runWithSystemAccess((tx) =>
      this.auditService.log(tx, {
        companyId: distributorCompanyId,
        actorType: 'system',
        action: 'reconciliation_cross_tenant_read_by_manufacturer',
        recordType: 'company',
        recordId: companyId,
        newValue: {
          manufacturerCompanyId: companyId,
          periodStart: periodStartStr,
          periodEnd: periodEndStr,
        },
      }),
    )

    return {
      distributorId,
      distributorCompanyId,
      periodStart,
      periodEnd,
      manufacturerMatchedCaseCount,
      distributorTenantCaseCount,
    }
  }
}
