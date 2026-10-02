import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallDistributionRecordDto } from './dto/create-recall-distribution-record.dto'
import { ImportRecallDistributionDto } from './dto/import-recall-distribution.dto'
import { RecallDistributionService } from './recall-distribution.service'

@ApiTags('recall-distribution')
@Controller('recalls/:recallId')
export class RecallDistributionController {
  constructor(private readonly recallDistributionService: RecallDistributionService) {}

  @RequirePermissions('quality.view_all')
  @Get('distribution-records')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallDistributionService.list(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('distribution-records')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallDistributionRecordDto,
    @Req() req: Request,
  ) {
    return this.recallDistributionService.createRecord(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('distribution-records/import')
  importCsv(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: ImportRecallDistributionDto,
    @Req() req: Request,
  ) {
    return this.recallDistributionService.importCsv(actor, recallId, dto.csv, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('import-jobs')
  listImportJobs(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallDistributionService.listImportJobs(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('cascade-invites/:stakeholderId')
  invite(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Param('stakeholderId') stakeholderId: string,
    @Req() req: Request,
  ) {
    return this.recallDistributionService.inviteToCascade(actor, recallId, stakeholderId, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('cascade-invites')
  listInvites(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallDistributionService.listCascadeInvites(actor, recallId)
  }
}
