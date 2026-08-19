import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CallLogService } from './call-log.service'
import { ListCallLogsQueryDto } from './dto/list-call-logs-query.dto'
import { LogCallDto } from './dto/log-call.dto'

/** VigiCloud Stage 3.5 — "Log a call," gated by the same `pv.capture_case` permission as capturing a case from the web-form wizard, since logging a call that resulted in a case is functionally the same act performed through a different intake channel. */
@ApiTags('pv-call-logs')
@Controller('pv/call-logs')
export class CallLogController {
  constructor(private readonly callLogService: CallLogService) {}

  @RequirePermissions('pv.capture_case')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogCallDto, @Req() req: Request) {
    return this.callLogService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.capture_case')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCallLogsQueryDto) {
    return this.callLogService.list(user, query)
  }
}
