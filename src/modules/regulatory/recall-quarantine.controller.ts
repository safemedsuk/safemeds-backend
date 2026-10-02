import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallQuarantineRecordDto } from './dto/create-recall-quarantine-record.dto'
import { CreateRecallReturnRecordDto } from './dto/create-recall-return-record.dto'
import { VerifyRecallReturnRecordDto } from './dto/verify-recall-return-record.dto'
import { RecallQuarantineService } from './recall-quarantine.service'

@ApiTags('recall-quarantine-returns')
@Controller('recalls/:recallId')
export class RecallQuarantineController {
  constructor(private readonly recallQuarantineService: RecallQuarantineService) {}

  @RequirePermissions('quality.view_all')
  @Get('quarantine-records')
  listQuarantine(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallQuarantineService.listQuarantine(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('quarantine-records')
  recordQuarantine(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallQuarantineRecordDto,
    @Req() req: Request,
  ) {
    return this.recallQuarantineService.recordQuarantine(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('return-records')
  listReturns(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallQuarantineService.listReturns(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('return-records')
  createReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallReturnRecordDto,
    @Req() req: Request,
  ) {
    return this.recallQuarantineService.createReturn(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('return-records/:id/verify')
  verifyReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') _recallId: string,
    @Param('id') id: string,
    @Body() dto: VerifyRecallReturnRecordDto,
    @Req() req: Request,
  ) {
    return this.recallQuarantineService.verifyReturn(actor, id, dto, { ip: req.ip })
  }
}
