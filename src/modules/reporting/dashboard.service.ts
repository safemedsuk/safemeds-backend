import { ForbiddenException, Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { RiskManagementPlanService } from './risk-management-plan.service'
import { SafetyAlertService } from './safety-alert.service'

export interface ReportingDashboard {
  cases: { byState: { stateKey: string; count: number }[]; totalOpen: number }
  deadlines: { breached: number; approaching24h: number; approaching72h: number }
  signals: { open: number; freshlyDetected: number }
  rmpRenewalsDue: number
  safetyAlertsOpen: number
  periodicReportsDue: number
  lineListingsDue: number
  /**
   * RegCloud (Phase 12) Stage 17 — extends this same live-computed
   * payload with the master registration lifecycle's own shape, per
   * `todo-regcloud.md`'s own instruction to extend `DashboardService`
   * rather than build a second, parallel dashboard. `dossiersByStage`
   * reads the denormalized `RegDossier.status` column, matching
   * `cases.byState`'s own identical list-vs-single-record-read
   * performance tradeoff.
   */
  regulatory: {
    registrationsByStatus: { status: string; count: number }[]
    dossiersByStage: { stage: string; count: number }[]
    upcomingRenewals30d: number
    upcomingRenewals90d: number
    openQueries: number
  }
  /**
   * Real-usage request, 11 Sep 2026 — "the unified, real-time view...
   * every product's live compliance status, what's at risk, what's
   * overdue." One row per product, live-computed the same way every
   * other section of this dashboard already is — never a stored/cached
   * summary. QualCloud has no data of its own yet (see `qualcloud`
   * below), so this rollup is PV (open cases with a missed reporting
   * deadline) + RegCloud (registration status/expiry, open regulator
   * queries) only.
   */
  productCompliance: ProductComplianceRow[]
  /**
   * Real-usage request, 11 Sep 2026 — "build the RegCloud and QualCloud
   * dashboards (only VigiCloud exists today)." RegCloud's own numbers
   * are already folded into `regulatory` above; QualCloud has no schema
   * at all yet (confirmed with the user as a real, deliberate scope
   * boundary for this pass) — `available: false` lets the frontend
   * render an honest "coming soon" placeholder instead of a silent gap
   * or a fabricated one.
   */
  qualcloud: { available: false }
}

export interface ProductComplianceRow {
  productId: string
  brandName: string
  openCases: number
  overdueDeadlines: number
  registrationStatus: string | null
  registrationExpiresOn: string | null
  registrationExpiringSoon: boolean
  openQueries: number
}

const PERIODIC_REPORT_TYPE_KEYS = ['psur', 'pbrer', 'dsur', 'pader', 'cioms_ii']
const TERMINAL_CASE_STATES = ['submitted']
const TERMINAL_SIGNAL_STATES = ['non_validated', 'not_confirmed', 'action_recommended', 'refuted']
const DUE_SOON_HORIZON_DAYS = 30

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'The reporting dashboard is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 18 — a role-*aware* dashboard, not several separate
 * role-*exclusive* endpoints: every section is computed live (matching
 * `AuditReadinessService.getDashboard()`'s own "never a fabricated
 * status" precedent — no cached/stored summary row), returned as one
 * flat payload, and the frontend emphasizes the sections relevant to
 * the current actor's role rather than the backend maintaining N
 * near-duplicate endpoints for processor/medical-reviewer/QC/QPPV. Case
 * counts read the denormalized `Case.status` column deliberately — the
 * same "list, not single-record-read" performance tradeoff that
 * column's own schema doc comment already established for `list()`
 * elsewhere.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly rls: RlsService,
    private readonly rmpService: RiskManagementPlanService,
    private readonly safetyAlertService: SafetyAlertService,
  ) {}

  async getDashboard(actor: AuthenticatedUser): Promise<ReportingDashboard> {
    const companyId = requireCompany(actor)
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000)
    const dueSoonHorizon = new Date(now.getTime() + DUE_SOON_HORIZON_DAYS * 24 * 60 * 60 * 1000)

    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const in90d = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

    const {
      cases,
      deadlines,
      signals,
      periodicReportsDue,
      lineListingsDue,
      regulatory,
      productCompliance,
    } = await this.rls.runAsCompany(companyId, async (tx) => {
      const caseGroups = await tx.case.groupBy({
        by: ['status'],
        where: { companyId, status: { notIn: TERMINAL_CASE_STATES } },
        _count: true,
      })
      const cases = {
        byState: caseGroups.map((g) => ({ stateKey: g.status, count: g._count })),
        totalOpen: caseGroups.reduce((sum, g) => sum + g._count, 0),
      }

      const [breached, approaching24h, approaching72h] = await Promise.all([
        tx.deadline.count({ where: { companyId, status: 'missed' } }),
        tx.deadline.count({ where: { companyId, status: 'pending', dueAt: { lte: in24h } } }),
        tx.deadline.count({ where: { companyId, status: 'pending', dueAt: { lte: in72h } } }),
      ])
      const deadlines = { breached, approaching24h, approaching72h }

      const [open, freshlyDetected] = await Promise.all([
        tx.signal.count({ where: { companyId, status: { notIn: TERMINAL_SIGNAL_STATES } } }),
        tx.signal.count({ where: { companyId, status: 'detected' } }),
      ])
      const signals = { open, freshlyDetected }

      const periodicReportsDue = await tx.generatedReport.count({
        where: {
          companyId,
          moduleKey: 'pv',
          reportTypeKey: { in: PERIODIC_REPORT_TYPE_KEYS },
          status: { not: 'submitted' },
          dueAt: { lte: dueSoonHorizon },
        },
      })
      const lineListingsDue = await tx.generatedReport.count({
        where: {
          companyId,
          moduleKey: 'pv',
          reportTypeKey: 'line_listing',
          status: { not: 'submitted' },
          dueAt: { lte: dueSoonHorizon },
        },
      })

      // RegCloud (Phase 12) Stage 17.
      const registrationGroups = await tx.productRegistration.groupBy({
        by: ['status'],
        where: { companyId },
        _count: true,
      })
      const dossierGroups = await tx.regDossier.groupBy({
        by: ['status'],
        where: { companyId },
        _count: true,
      })
      const [upcomingRenewals30d, upcomingRenewals90d, openQueries] = await Promise.all([
        tx.regDeadline.count({
          where: {
            companyId,
            recordType: 'reg_registration_renewal',
            status: 'pending',
            dueAt: { lte: in30d },
          },
        }),
        tx.regDeadline.count({
          where: {
            companyId,
            recordType: 'reg_registration_renewal',
            status: 'pending',
            dueAt: { lte: in90d },
          },
        }),
        tx.regQuery.count({ where: { companyId, status: 'open' } }),
      ])
      const regulatory = {
        registrationsByStatus: registrationGroups.map((g) => ({
          status: g.status,
          count: g._count,
        })),
        dossiersByStage: dossierGroups.map((g) => ({ stage: g.status, count: g._count })),
        upcomingRenewals30d,
        upcomingRenewals90d,
        openQueries,
      }

      // Real-usage request, 11 Sep 2026 — per-product compliance rollup.
      // Capped at the company's most-recently-created 50 products — this
      // dashboard summarizes "what needs attention," not a paginated
      // catalog browse (that's Master Data's own job); a company with
      // more than 50 products revisits this cap when real usage shows it
      // matters, matching this codebase's own "don't build ahead of a
      // confirmed need" discipline.
      const products = await tx.product.findMany({
        where: { companyId },
        select: { id: true, brandName: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const productCompliance: ProductComplianceRow[] = await Promise.all(
        products.map(async (p) => {
          const openCaseRows = await tx.case.findMany({
            where: {
              companyId,
              status: { notIn: TERMINAL_CASE_STATES },
              suspectProducts: { some: { productId: p.id } },
            },
            select: { id: true },
          })
          const overdueDeadlines = openCaseRows.length
            ? await tx.deadline.count({
                where: {
                  companyId,
                  recordType: 'pv_case',
                  recordId: { in: openCaseRows.map((c) => c.id) },
                  status: 'missed',
                },
              })
            : 0
          const registration = await tx.productRegistration.findFirst({
            where: { companyId, productId: p.id },
            orderBy: { expiresOn: 'desc' },
          })
          const openQueries = await tx.regQuery.count({
            where: { companyId, regDossier: { productId: p.id }, status: 'open' },
          })

          return {
            productId: p.id,
            brandName: p.brandName,
            openCases: openCaseRows.length,
            overdueDeadlines,
            registrationStatus: registration?.status ?? null,
            registrationExpiresOn: registration?.expiresOn?.toISOString() ?? null,
            registrationExpiringSoon: registration
              ? registration.expiresOn <= dueSoonHorizon
              : false,
            openQueries,
          }
        }),
      )

      return {
        cases,
        deadlines,
        signals,
        periodicReportsDue,
        lineListingsDue,
        regulatory,
        productCompliance,
      }
    })

    const [rmpRenewalsDue, safetyAlertsOpen] = await Promise.all([
      this.rmpService.countRenewalsDue(companyId),
      this.safetyAlertService.countOpen(companyId),
    ])

    return {
      cases,
      deadlines,
      signals,
      rmpRenewalsDue,
      safetyAlertsOpen,
      periodicReportsDue,
      lineListingsDue,
      regulatory,
      productCompliance,
      qualcloud: { available: false },
    }
  }
}
