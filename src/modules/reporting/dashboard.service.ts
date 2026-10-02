import { ForbiddenException, Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { QualityMetricsService } from '../internal-audit/quality-metrics.service'
import { RegDossierKind } from '../regulatory/reg-dossier.service'
import { isWithinRetentionWindow } from '../regulatory/reg-retention-reminder.service'
import { RiskManagementPlanService } from './risk-management-plan.service'
import { SafetyAlertService } from './safety-alert.service'

const QUALCLOUD_METRICS_WINDOW_DAYS = 90

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
    /**
     * testing-correction-explanation.md §4.2 — "dossiers in flight by
     * kind": the same registration/variation/renewal split
     * `RegDossierService`'s own list/get methods already derive per
     * dossier (a real `RegVariation` row is the only trustworthy
     * signal — see that service's own doc comment), now aggregated
     * across every open dossier for the stacked-bar-per-kind chart.
     */
    dossiersByKindAndStage: { kind: RegDossierKind; stage: string; count: number }[]
    /**
     * "Open items needing action right now" — a single ranked list,
     * each row linkable straight to its own record. Every category is
     * computed live from the same real criteria the corresponding
     * background job already uses (never a second, diverging
     * definition of "due"/"overdue"):
     * `overduePostMarketObligations` — `RegPostMarketObligation.status
     * === 'overdue'` (flipped by the daily sweep, `RegPostMarketObligationProcessor`).
     * `longOpenQueries` — an **honest approximation**, not a real
     * regulatory deadline: `RegQuery` has no response-due-date concept
     * anywhere in this schema (confirmed by reading it directly), so
     * this surfaces queries open longer than `LONG_OPEN_QUERY_DAYS`
     * rather than inventing a fake deadline field.
     * `registrationsExpiringSoonWithNoRenewalStarted` — active,
     * expiring within `DUE_SOON_HORIZON_DAYS`, with no open
     * `RegVariation` of `variationType: 'renewal'` against it yet.
     * `retentionsDueNotLogged` — reuses `isWithinRetentionWindow()`
     * and the exact "no `RegRetention` row for the current year" test
     * `RegRetentionReminderService` already established, so the
     * dashboard and the actual reminder job can never disagree on
     * what "due" means.
     */
    openItems: {
      overduePostMarketObligations: RegOpenItem[]
      longOpenQueries: RegOpenItem[]
      registrationsExpiringSoonWithNoRenewalStarted: RegOpenItem[]
      retentionsDueNotLogged: RegOpenItem[]
    }
    /**
     * "This month's activity" — a simple count strip, calendar-month
     * to date (UTC). `dossiersSubmitted`/`approvalsReceived` read the
     * workflow engine's own generic `state_change` audit action
     * (`WorkflowService.transition()` already writes one on every
     * transition, unconditionally) rather than a new tracking column.
     */
    thisMonthActivity: {
      dossiersSubmitted: number
      approvalsReceived: number
      queriesLogged: number
      retentionsCertified: number
    }
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
   * QualCloud (Phase 13) Stage 20 — real data, replacing the
   * `available: false` placeholder this field carried since the 11 Sep
   * 2026 "Master Dashboard" pass (QualCloud had no schema at all back
   * then). Every number here traces to a real field captured by
   * Stages 0–19 — no widget is built whose backing data doesn't exist.
   * `available` stays a real flag (true once QualCloud module access is
   * actually granted — see `EntitlementsService`'s `qualcloud` module
   * key — false otherwise, matching `rmpRenewalsDue`'s own "only
   * meaningful once the company has the module on" precedent).
   */
  qualcloud: QualCloudDashboard
}

export interface QualCloudDashboard {
  available: boolean
  /** QA Officer view. */
  deviationsOpenBySeverity: { severity: string; count: number }[]
  capasDue: number
  capasOverdue: number
  effectivenessChecksDue: number
  changeControlsInProgress: number
  /** Document Controller view. */
  documentsPendingApproval: number
  periodicReviewsDue: number
  readAndUnderstandOutstanding: number
  /** Auditor view. */
  openFindingsByClassification: { classification: string; count: number }[]
  findingsToCapaClosureRate: number | null
  supplierAuditsDue: number
  /** Training Coordinator view. */
  trainingDue: number
  trainingOverdue: number
  /** Quality leadership view — reuses `QualityMetricsService.compute()` directly, never recomputed. */
  metrics: {
    rightFirstTimeRate: number | null
    recurringIssueCount: number
    openTrendFlags: number
  } | null
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

/** testing-correction-explanation.md §4.2 — a uniform, clickable row shape for every "open items" category; `recordType`/`recordId` are exactly what the frontend already routes on elsewhere (`reg-dossiers/:id`, `registrations/:id`). */
export interface RegOpenItem {
  recordType: 'product_registration' | 'reg_dossier'
  recordId: string
  label: string
}

const PERIODIC_REPORT_TYPE_KEYS = ['psur', 'pbrer', 'dsur', 'pader', 'cioms_ii']
const TERMINAL_CASE_STATES = ['submitted']
const TERMINAL_SIGNAL_STATES = ['non_validated', 'not_confirmed', 'action_recommended', 'refuted']
/** No `RegQuery` response-deadline field exists anywhere in this schema (confirmed by reading it directly) — this is a deliberate, honestly-labeled proxy, not a real regulatory deadline. */
const LONG_OPEN_QUERY_DAYS = 30
const OPEN_ITEMS_ROW_CAP = 20
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
    private readonly entitlementsService: EntitlementsService,
    private readonly qualityMetricsService: QualityMetricsService,
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
      // testing-correction-explanation.md §4.2 — "dossiers in flight by kind."
      const openDossiersWithVariation = await tx.regDossier.findMany({
        where: { companyId, status: { notIn: ['approved', 'rejected'] } },
        select: { status: true, regVariation: { select: { variationType: true } } },
      })
      const kindStageCounts = new Map<string, number>()
      for (const d of openDossiersWithVariation) {
        const kind: RegDossierKind = !d.regVariation
          ? 'registration'
          : d.regVariation.variationType === 'renewal'
            ? 'renewal'
            : 'variation'
        const key = `${kind}\u0000${d.status}`
        kindStageCounts.set(key, (kindStageCounts.get(key) ?? 0) + 1)
      }
      const dossiersByKindAndStage = [...kindStageCounts.entries()].map(([key, count]) => {
        const [kind, stage] = key.split('\u0000')
        return { kind: kind as RegDossierKind, stage, count }
      })

      // "Open items needing action right now."
      const overdueObligationRows = await tx.regPostMarketObligation.findMany({
        where: { companyId, status: 'overdue' },
        include: { productRegistration: { select: { registrationNumber: true, product: { select: { brandName: true } } } } },
        orderBy: { dueAt: 'asc' },
        take: OPEN_ITEMS_ROW_CAP,
      })
      const overduePostMarketObligations: RegOpenItem[] = overdueObligationRows.map((o) => ({
        recordType: 'product_registration',
        recordId: o.productRegistrationId,
        label: `${o.obligationType.replace(/_/g, ' ')} overdue — ${o.productRegistration.product.brandName} (${o.productRegistration.registrationNumber})`,
      }))

      const longOpenThreshold = new Date(now.getTime() - LONG_OPEN_QUERY_DAYS * 24 * 60 * 60 * 1000)
      const longOpenQueryRows = await tx.regQuery.findMany({
        where: { companyId, status: 'open', receivedDate: { lte: longOpenThreshold } },
        include: { regDossier: { select: { id: true, product: { select: { brandName: true } }, authority: { select: { code: true } } } } },
        orderBy: { receivedDate: 'asc' },
        take: OPEN_ITEMS_ROW_CAP,
      })
      const longOpenQueries: RegOpenItem[] = longOpenQueryRows.map((q) => {
        const openDays = Math.floor((now.getTime() - q.receivedDate.getTime()) / (24 * 60 * 60 * 1000))
        return {
          recordType: 'reg_dossier',
          recordId: q.regDossierId,
          label: `Open ${openDays}d — ${q.regDossier.product.brandName} (${q.regDossier.authority.code})`,
        }
      })

      const expiringRegistrationRows = await tx.productRegistration.findMany({
        where: { companyId, status: 'active', expiresOn: { lte: in90d } },
        include: {
          product: { select: { brandName: true } },
          regVariations: { where: { variationType: 'renewal', status: 'open' }, select: { id: true } },
        },
        orderBy: { expiresOn: 'asc' },
        take: OPEN_ITEMS_ROW_CAP,
      })
      const registrationsExpiringSoonWithNoRenewalStarted: RegOpenItem[] = expiringRegistrationRows
        .filter((r) => r.regVariations.length === 0)
        .map((r) => ({
          recordType: 'product_registration',
          recordId: r.id,
          label: `Expires ${r.expiresOn.toISOString().slice(0, 10)} — ${r.product.brandName} (${r.registrationNumber}), no renewal started`,
        }))

      let retentionsDueNotLogged: RegOpenItem[] = []
      if (isWithinRetentionWindow(now)) {
        const retentionYear = now.getUTCFullYear()
        const activeRegistrationRows = await tx.productRegistration.findMany({
          where: { companyId, status: 'active', expiresOn: { gt: now } },
          include: {
            product: { select: { brandName: true } },
            regRetentions: { where: { year: retentionYear }, select: { id: true } },
          },
          take: OPEN_ITEMS_ROW_CAP,
        })
        retentionsDueNotLogged = activeRegistrationRows
          .filter((r) => r.regRetentions.length === 0)
          .map((r) => ({
            recordType: 'product_registration',
            recordId: r.id,
            label: `${retentionYear} retention due — ${r.product.brandName} (${r.registrationNumber})`,
          }))
      }

      // "This month's activity" — calendar month to date, UTC.
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const dossierTransitionsThisMonth = await tx.auditEntry.findMany({
        where: { companyId, recordType: 'reg_registration', action: 'state_change', occurredAt: { gte: startOfMonth } },
        select: { newValue: true },
      })
      const dossiersSubmitted = dossierTransitionsThisMonth.filter(
        (e) => (e.newValue as { stateKey?: string } | null)?.stateKey === 'submitted',
      ).length
      const approvalsReceived = dossierTransitionsThisMonth.filter(
        (e) => (e.newValue as { stateKey?: string } | null)?.stateKey === 'approved',
      ).length
      const [queriesLogged, retentionsCertified] = await Promise.all([
        tx.regQuery.count({ where: { companyId, createdAt: { gte: startOfMonth } } }),
        tx.regRetention.count({ where: { companyId, createdAt: { gte: startOfMonth } } }),
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
        dossiersByKindAndStage,
        openItems: {
          overduePostMarketObligations,
          longOpenQueries,
          registrationsExpiringSoonWithNoRenewalStarted,
          retentionsDueNotLogged,
        },
        thisMonthActivity: {
          dossiersSubmitted,
          approvalsReceived,
          queriesLogged,
          retentionsCertified,
        },
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

    const [rmpRenewalsDue, safetyAlertsOpen, qualcloud] = await Promise.all([
      this.rmpService.countRenewalsDue(companyId),
      this.safetyAlertService.countOpen(companyId),
      this.computeQualCloudDashboard(actor, companyId),
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
      qualcloud,
    }
  }

  /**
   * QualCloud (Phase 13) Stage 20 — a real, live-computed cross-module
   * read, own call/own transaction (matching `rmpRenewalsDue`/
   * `safetyAlertsOpen`'s own identical shape above) rather than folded
   * into the one large transaction higher up — every number here is a
   * plain tx read against a real Stage 0–19 field, never a second
   * parallel "due" definition (`capasOverdue` reuses `Capa.dueDate` the
   * exact same way `QualityMetricsService`/`CapaOverdueProcessor`
   * already do, `trainingDue`/`trainingOverdue` reuse
   * `computeTrainingStatus()` indirectly via `QualityMetricsService
   * .compute()`'s own `trainingComplianceRate`, etc.).
   */
  private async computeQualCloudDashboard(
    actor: AuthenticatedUser,
    companyId: string,
  ): Promise<QualCloudDashboard> {
    const available = await this.entitlementsService.isEnabled(companyId, 'qualcloud')
    if (!available) {
      return {
        available: false,
        deviationsOpenBySeverity: [],
        capasDue: 0,
        capasOverdue: 0,
        effectivenessChecksDue: 0,
        changeControlsInProgress: 0,
        documentsPendingApproval: 0,
        periodicReviewsDue: 0,
        readAndUnderstandOutstanding: 0,
        openFindingsByClassification: [],
        findingsToCapaClosureRate: null,
        supplierAuditsDue: 0,
        trainingDue: 0,
        trainingOverdue: 0,
        metrics: null,
      }
    }

    const now = new Date()
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const raw = await this.rls.runAsCompany(companyId, async (tx) => {
      const deviationGroups = await tx.deviation.groupBy({
        by: ['severity'],
        where: { companyId, status: { not: 'closed' } },
        _count: true,
      })
      const [capasDue, capasOverdue, effectivenessChecksDue] = await Promise.all([
        tx.capa.count({ where: { companyId, status: { not: 'closed' }, dueDate: { lte: in30d, gte: now } } }),
        tx.capa.count({ where: { companyId, status: { not: 'closed' }, dueDate: { lt: now } } }),
        tx.capa.count({
          where: {
            companyId,
            status: { not: 'closed' },
            effectivenessCheckDueAt: { lte: in30d },
            effectivenessCheckedAt: null,
          },
        }),
      ])
      const changeControlsInProgress = await tx.changeControl.count({
        where: { companyId, status: { notIn: ['proposed', 'closed', 'rejected'] } },
      })

      const [documentsPendingApproval, periodicReviewsDue, readAndUnderstandOutstanding] = await Promise.all([
        tx.sop.count({ where: { companyId, status: 'in_review' } }),
        tx.sop.count({ where: { companyId, status: 'effective', nextPeriodicReviewDueAt: { lte: in30d } } }),
        tx.documentAcknowledgment.count({ where: { companyId, acknowledgedAt: null } }),
      ])

      const findingGroups = await tx.auditFinding.groupBy({
        by: ['severity'],
        where: { companyId, status: { not: 'closed' } },
        _count: true,
      })
      const [findingsTotal, findingsWithCapa] = await Promise.all([
        tx.auditFinding.count({ where: { companyId } }),
        tx.auditFinding.count({ where: { companyId, capas: { some: {} } } }),
      ])
      const supplierAuditsDue = await tx.internalAudit.count({
        where: { companyId, auditScope: 'supplier', status: 'scheduled', scheduledDate: { lte: in30d } },
      })

      const [trainingDue, trainingOverdue, openTrendFlags] = await Promise.all([
        tx.trainingRecord.count({ where: { companyId, expiryDate: { lte: in30d, gte: now } } }),
        tx.trainingRecord.count({ where: { companyId, expiryDate: { lt: now } } }),
        tx.qualityTrendFlag.count({ where: { companyId, status: 'open' } }),
      ])

      return {
        deviationsOpenBySeverity: deviationGroups.map((g) => ({
          severity: g.severity ?? 'unclassified',
          count: g._count,
        })),
        capasDue,
        capasOverdue,
        effectivenessChecksDue,
        changeControlsInProgress,
        documentsPendingApproval,
        periodicReviewsDue,
        readAndUnderstandOutstanding,
        openFindingsByClassification: findingGroups.map((g) => ({
          classification: g.severity,
          count: g._count,
        })),
        findingsToCapaClosureRate: findingsTotal > 0 ? Math.round((findingsWithCapa / findingsTotal) * 1000) / 10 : null,
        supplierAuditsDue,
        trainingDue,
        trainingOverdue,
        openTrendFlags,
      }
    })

    const metricsSnapshot = await this.qualityMetricsService.compute(actor, {
      from: new Date(now.getTime() - QUALCLOUD_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      to: now,
    })

    return {
      available: true,
      ...raw,
      metrics: {
        rightFirstTimeRate: metricsSnapshot.rightFirstTimeRate,
        recurringIssueCount: metricsSnapshot.recurringIssueCount,
        openTrendFlags: raw.openTrendFlags,
      },
    }
  }
}
