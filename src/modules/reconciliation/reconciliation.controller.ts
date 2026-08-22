import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { GenerateReconciliationReportDto } from './dto/generate-reconciliation-report.dto'
import { ManuallyReconcileCaseDto } from './dto/manually-reconcile-case.dto'
import { ReconciliationPeriodQueryDto } from './dto/reconciliation-period-query.dto'
import { ReconciliationService } from './reconciliation.service'

@ApiTags('reconciliation')
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get('unmatched')
  listUnmatched(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReconciliationPeriodQueryDto,
  ) {
    return this.reconciliationService.listUnmatched(user, query.periodStart, query.periodEnd)
  }

  @RequirePermissions('reconciliation.manage')
  @Post('cases/:caseId')
  manuallyReconcileCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() dto: ManuallyReconcileCaseDto,
    @Req() req: Request,
  ) {
    return this.reconciliationService.manuallyReconcileCase(user, caseId, dto, { ip: req.ip })
  }

  @RequirePermissions('reconciliation.manage')
  @Post('reports')
  generateReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateReconciliationReportDto,
    @Req() req: Request,
  ) {
    return this.reconciliationService.generateReport(user, dto, { ip: req.ip })
  }

  @Get('reports')
  listReports(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.reconciliationService.listReports(user, query)
  }

  @Get('reports/:id')
  getReport(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reconciliationService.getReport(user, id)
  }

  @Get('distributors/:id/cross-tenant-summary')
  crossTenantSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ReconciliationPeriodQueryDto,
  ) {
    return this.reconciliationService.crossTenantSummary(
      user,
      id,
      query.periodStart,
      query.periodEnd,
    )
  }
}
