import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecordEnvironmentalMonitoringResultDto } from './dto/environmental-monitoring.dto'
import { EnvironmentalMonitoringService } from './environmental-monitoring.service'

@ApiTags('quality-environmental-monitoring')
@Controller('quality/environmental-monitoring')
export class EnvironmentalMonitoringController {
  constructor(private readonly service: EnvironmentalMonitoringService) {}

  @RequirePermissions('quality.manage_environmental_monitoring')
  @Post()
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordEnvironmentalMonitoringResultDto,
    @Req() req: Request,
  ) {
    return this.service.record(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('facilityId') facilityId?: string,
    @Query('excursionOnly') excursionOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user, {
      facilityId,
      excursionOnly: excursionOnly === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    })
  }
}
