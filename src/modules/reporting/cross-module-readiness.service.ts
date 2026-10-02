import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AuditReadinessDashboard, AuditReadinessService } from '../governance/audit-readiness.service'
import { InspectionReadinessService, InspectionReadinessSnapshot } from '../internal-audit/inspection-readiness.service'
import { DashboardService } from './dashboard.service'

export interface CrossModuleReadiness {
  /** VigiCloud — PPB's own 15-item PV inspection checklist (Stage 16.2, unchanged, reused as-is). */
  vigicloud: { overall: 'green' | 'amber' | 'red'; readyCount: number; totalMandatory: number }
  /** QualCloud — the real 8-section structural GMP checklist (Stage 9, unchanged, reused as-is). */
  qualcloud: { overall: 'ready' | 'needs_attention'; authorityConfigured: boolean }
  /**
   * RegCloud has no dedicated audit-checklist/readiness concept of its
   * own (confirmed by reading `src/modules/regulatory/` directly — only
   * `MockRecallReadinessService` exists, a different, narrower thing).
   * This is an honest proxy built from `DashboardService`'s own
   * already-live `regulatory.openItems` — "is anything overdue or
   * expiring with no renewal started" is the closest real RegCloud
   * concept to "inspection readiness" that actually exists today.
   */
  regulatory: { openItemCount: number; overall: 'ready' | 'needs_attention' }
}

/**
 * QualCloud (Phase 13) Stage 20 — the cross-module Inspection/Audit-
 * Readiness view. A pure, thin read composition over three already-
 * built dashboard-shaped services, called as three separate requests
 * (never nested inside one shared transaction) — exactly the shape
 * this stage's own build spec calls for: "reuse, don't rebuild."
 */
@Injectable()
export class CrossModuleReadinessService {
  constructor(
    private readonly auditReadinessService: AuditReadinessService,
    private readonly inspectionReadinessService: InspectionReadinessService,
    private readonly dashboardService: DashboardService,
  ) {}

  async getReadiness(actor: AuthenticatedUser): Promise<CrossModuleReadiness> {
    const [vigicloud, qualcloud, dashboard]: [
      AuditReadinessDashboard,
      InspectionReadinessSnapshot,
      Awaited<ReturnType<DashboardService['getDashboard']>>,
    ] = await Promise.all([
      this.auditReadinessService.getDashboard(actor),
      this.inspectionReadinessService.getSnapshot(actor),
      this.dashboardService.getDashboard(actor),
    ])

    const openItems = dashboard.regulatory.openItems
    const openItemCount =
      openItems.overduePostMarketObligations.length +
      openItems.longOpenQueries.length +
      openItems.registrationsExpiringSoonWithNoRenewalStarted.length +
      openItems.retentionsDueNotLogged.length

    return {
      vigicloud: {
        overall: vigicloud.overall,
        readyCount: vigicloud.readyCount,
        totalMandatory: vigicloud.totalMandatory,
      },
      qualcloud: {
        overall: qualcloud.overall,
        authorityConfigured: qualcloud.authorityConfigured,
      },
      regulatory: {
        openItemCount,
        overall: openItemCount === 0 ? 'ready' : 'needs_attention',
      },
    }
  }
}
