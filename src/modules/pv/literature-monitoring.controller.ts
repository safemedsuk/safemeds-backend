import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListLiteratureRunsQueryDto } from './dto/list-literature-runs-query.dto'
import { LogLiteratureRunDto } from './dto/log-literature-run.dto'
import { LiteratureMonitoringService } from './literature-monitoring.service'

@ApiTags('literature-monitoring')
@Controller('literature-monitoring-runs')
export class LiteratureMonitoringController {
  constructor(private readonly literatureMonitoringService: LiteratureMonitoringService) {}

  @RequirePermissions('pv.manage_literature_monitoring')
  @Post()
  logRun(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogLiteratureRunDto,
    @Req() req: Request,
  ) {
    return this.literatureMonitoringService.logRun(user, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_literature_monitoring')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListLiteratureRunsQueryDto) {
    return this.literatureMonitoringService.list(user, query)
  }
}
