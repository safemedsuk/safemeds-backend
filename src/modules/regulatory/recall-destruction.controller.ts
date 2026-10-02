import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AttachRecallDisposalApprovalDto } from './dto/attach-recall-disposal-approval.dto'
import { CompleteRecallDestructionDto } from './dto/complete-recall-destruction.dto'
import { CreateRecallDestructionRecordDto } from './dto/create-recall-destruction-record.dto'
import { CreateRecallEffectivenessCheckDto } from './dto/create-recall-effectiveness-check.dto'
import { RecallDestructionService } from './recall-destruction.service'

@ApiTags('recall-destruction-effectiveness')
@Controller('recall-countries/:id')
export class RecallDestructionController {
  constructor(private readonly recallDestructionService: RecallDestructionService) {}

  @RequirePermissions('quality.view_all')
  @Get('destruction-records')
  listDestructionRecords(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallDestructionService.listDestructionRecords(actor, id)
  }

  @RequirePermissions('quality.log_recall')
  @Post('destruction-records')
  createDestructionRecord(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRecallDestructionRecordDto,
    @Req() req: Request,
  ) {
    return this.recallDestructionService.createDestructionRecord(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('effectiveness-checks')
  listEffectivenessChecks(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallDestructionService.listEffectivenessChecks(actor, id)
  }

  @RequirePermissions('quality.log_recall')
  @Post('effectiveness-checks')
  createEffectivenessCheck(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRecallEffectivenessCheckDto,
    @Req() req: Request,
  ) {
    return this.recallDestructionService.createEffectivenessCheck(actor, id, dto, { ip: req.ip })
  }
}

/** A second, separate controller only because these actions key off the destruction/check's own id, not a recall-country id — same service. */
@ApiTags('recall-destruction-effectiveness')
@Controller()
export class RecallDestructionActionsController {
  constructor(private readonly recallDestructionService: RecallDestructionService) {}

  @RequirePermissions('quality.log_recall')
  @Post('recall-destruction-records/:id/disposal-approval')
  attachDisposalApproval(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachRecallDisposalApprovalDto,
    @Req() req: Request,
  ) {
    return this.recallDestructionService.attachDisposalApproval(
      actor,
      id,
      dto.disposalApprovalEvidenceId,
      { ip: req.ip },
    )
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-destruction-records/:id/mark-destroyed')
  markDestroyed(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallDestructionService.markDestroyed(actor, id, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-destruction-records/:id/certificate')
  completeDestruction(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CompleteRecallDestructionDto,
    @Req() req: Request,
  ) {
    return this.recallDestructionService.completeDestruction(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-effectiveness-checks/:id/close')
  closeEffectivenessCheck(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.recallDestructionService.closeEffectivenessCheck(actor, id, { ip: req.ip })
  }
}
