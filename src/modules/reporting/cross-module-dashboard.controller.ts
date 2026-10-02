import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CrossModuleReadinessService } from './cross-module-readiness.service'
import { ExecutiveDashboardService } from './executive-dashboard.service'
import { ObligationsFeedService } from './obligations-feed.service'

/** QualCloud (Phase 13) Stage 20 — the three new cross-module read endpoints, all gated by the same `reports.view` permission `DashboardController`'s own single-dashboard endpoint already uses. */
@ApiTags('reporting-cross-module')
@Controller('reporting')
export class CrossModuleDashboardController {
  constructor(
    private readonly crossModuleReadinessService: CrossModuleReadinessService,
    private readonly obligationsFeedService: ObligationsFeedService,
    private readonly executiveDashboardService: ExecutiveDashboardService,
  ) {}

  @RequirePermissions('reports.view')
  @Get('inspection-readiness-overview')
  getReadiness(@CurrentUser() user: AuthenticatedUser) {
    return this.crossModuleReadinessService.getReadiness(user)
  }

  @RequirePermissions('reports.view')
  @Get('obligations')
  getObligations(@CurrentUser() user: AuthenticatedUser) {
    return this.obligationsFeedService.getFeed(user)
  }

  @RequirePermissions('reports.view')
  @Get('executive-dashboard')
  getExecutiveDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.executiveDashboardService.getExecutiveDashboard(user)
  }
}
