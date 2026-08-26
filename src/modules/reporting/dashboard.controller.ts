import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DashboardService } from './dashboard.service'

@ApiTags('reporting-dashboard')
@Controller('reporting/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @RequirePermissions('reports.view')
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getDashboard(user)
  }
}
