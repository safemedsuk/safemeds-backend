import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { PlatformDashboardService } from './platform-dashboard.service'
import { PlatformOnly } from './platform-only.decorator'

@ApiTags('platform')
@Controller('platform/dashboard')
@PlatformOnly('super_admin', 'operations', 'regulatory_lead')
export class PlatformDashboardController {
  constructor(private readonly dashboardService: PlatformDashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboardService.getOverview()
  }

  @Get('regulatory-coverage')
  regulatoryCoverage() {
    return this.dashboardService.getRegulatoryCoverage()
  }
}
