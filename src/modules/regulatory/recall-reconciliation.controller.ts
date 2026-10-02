import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ApproveRecallDiscrepancyExceptionDto } from './dto/approve-recall-discrepancy-exception.dto'
import { CreateRecallDiscrepancyDto } from './dto/create-recall-discrepancy.dto'
import { RecallReconciliationService } from './recall-reconciliation.service'

@ApiTags('recall-reconciliation')
@Controller()
export class RecallReconciliationController {
  constructor(private readonly recallReconciliationService: RecallReconciliationService) {}

  @RequirePermissions('quality.log_recall')
  @Post('recall-countries/:id/reconciliation')
  calculate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallReconciliationService.calculate(actor, id, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('recall-countries/:id/reconciliation')
  listSnapshots(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallReconciliationService.listSnapshots(actor, id)
  }

  @RequirePermissions('quality.view_all')
  @Get('recalls/:recallId/discrepancies')
  listDiscrepancies(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallReconciliationService.listDiscrepancies(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('recalls/:recallId/discrepancies')
  createDiscrepancy(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallDiscrepancyDto,
    @Req() req: Request,
  ) {
    return this.recallReconciliationService.createDiscrepancy(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.approve_recall_exception')
  @Post('recall-discrepancies/:id/approve-exception')
  approveException(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveRecallDiscrepancyExceptionDto,
    @Req() req: Request,
  ) {
    return this.recallReconciliationService.approveException(actor, id, dto, { ip: req.ip })
  }
}
