import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BenefitRiskService } from './benefit-risk.service'

@ApiTags('benefit-risk')
@Controller('reporting/benefit-risk')
export class BenefitRiskController {
  constructor(private readonly benefitRiskService: BenefitRiskService) {}

  @RequirePermissions('reports.view')
  @Get(':productId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
    @Query('periodStart') periodStart?: string,
    @Query('periodEnd') periodEnd?: string,
  ) {
    return this.benefitRiskService.getSummary(
      user,
      productId,
      periodStart ? new Date(periodStart) : undefined,
      periodEnd ? new Date(periodEnd) : undefined,
    )
  }
}
