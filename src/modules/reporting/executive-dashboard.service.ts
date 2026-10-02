import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CrossModuleReadiness, CrossModuleReadinessService } from './cross-module-readiness.service'
import { DashboardService, ReportingDashboard } from './dashboard.service'
import { ObligationFeedItem, ObligationsFeedService } from './obligations-feed.service'

export interface ExecutiveDashboard {
  dashboard: ReportingDashboard
  readiness: CrossModuleReadiness
  /** The 10 soonest-due obligations, across every module — a preview, not the full feed (`GET /reporting/obligations` for that). */
  topObligations: ObligationFeedItem[]
}

const TOP_OBLIGATIONS_PREVIEW_COUNT = 10

/**
 * QualCloud (Phase 13) Stage 20 — the Unified Cross-Module Executive
 * Dashboard, "the actual payoff." Genuinely the last thing built in
 * this stage: a thin composition calling the three already-existing
 * dashboard-shaped services (never re-querying the database itself),
 * so it has nothing to compose until `DashboardService`'s own
 * `qualcloud` section, `CrossModuleReadinessService`, and
 * `ObligationsFeedService` all exist — which, as of this pass, they
 * now do.
 */
@Injectable()
export class ExecutiveDashboardService {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly crossModuleReadinessService: CrossModuleReadinessService,
    private readonly obligationsFeedService: ObligationsFeedService,
  ) {}

  async getExecutiveDashboard(actor: AuthenticatedUser): Promise<ExecutiveDashboard> {
    const [dashboard, readiness, obligations] = await Promise.all([
      this.dashboardService.getDashboard(actor),
      this.crossModuleReadinessService.getReadiness(actor),
      this.obligationsFeedService.getFeed(actor),
    ])

    return {
      dashboard,
      readiness,
      topObligations: obligations.slice(0, TOP_OBLIGATIONS_PREVIEW_COUNT),
    }
  }
}
