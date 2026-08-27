import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateSafetyAlertDto } from './dto/create-safety-alert.dto'
import { ListSafetyAlertsQueryDto } from './dto/list-safety-alerts-query.dto'
import { UpdateSafetyAlertStatusDto } from './dto/update-safety-alert-status.dto'
import { SafetyAlertService } from './safety-alert.service'

@ApiTags('safety-alerts')
@Controller('safety-alerts')
export class SafetyAlertController {
  constructor(private readonly safetyAlertService: SafetyAlertService) {}

  @RequirePermissions('safety_alerts.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSafetyAlertDto,
    @Req() req: Request,
  ) {
    return this.safetyAlertService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('safety_alerts.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSafetyAlertsQueryDto) {
    return this.safetyAlertService.list(user, query.status)
  }

  @RequirePermissions('safety_alerts.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.safetyAlertService.get(user, id)
  }

  @RequirePermissions('safety_alerts.manage')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSafetyAlertStatusDto,
    @Req() req: Request,
  ) {
    return this.safetyAlertService.updateStatus(user, id, dto, { ip: req.ip })
  }
}
