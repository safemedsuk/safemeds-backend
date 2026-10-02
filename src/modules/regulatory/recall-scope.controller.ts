import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallScopeVersionDto } from './dto/create-recall-scope-version.dto'
import { RecallScopeService } from './recall-scope.service'

@ApiTags('recall-scope')
@Controller()
export class RecallScopeController {
  constructor(private readonly recallScopeService: RecallScopeService) {}

  @RequirePermissions('quality.view_all')
  @Get('recalls/:recallId/scope-versions')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallScopeService.list(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('recalls/:recallId/scope-versions')
  createDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallScopeVersionDto,
    @Req() req: Request,
  ) {
    return this.recallScopeService.createDraft(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.approve_recall_scope')
  @Post('recall-scope-versions/:id/freeze')
  freeze(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallScopeService.freeze(actor, id, { ip: req.ip })
  }
}
