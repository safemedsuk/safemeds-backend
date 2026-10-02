import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SendRecallMessageDto } from './dto/send-recall-message.dto'
import { RecallMessageService } from './recall-message.service'

@ApiTags('recall-messages')
@Controller('recalls/:recallId/messages')
export class RecallMessageController {
  constructor(private readonly recallMessageService: RecallMessageService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallMessageService.list(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post()
  send(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: SendRecallMessageDto,
    @Req() req: Request,
  ) {
    return this.recallMessageService.send(actor, recallId, dto, { ip: req.ip })
  }
}
