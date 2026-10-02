import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import {
  CreateMaintenanceRecordDto,
  RecordEquipmentQualificationEventDto,
} from './dto/equipment-qualification.dto'
import { EquipmentQualificationService } from './equipment-qualification.service'

@ApiTags('quality-equipment-qualification')
@Controller('quality/equipment/:equipmentId')
export class EquipmentQualificationController {
  constructor(private readonly service: EquipmentQualificationService) {}

  @RequirePermissions('quality.manage_equipment')
  @Post('qualification-events')
  recordEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
    @Body() dto: RecordEquipmentQualificationEventDto,
    @Req() req: Request,
  ) {
    return this.service.recordEvent(user, equipmentId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('qualification-events')
  listEvents(@CurrentUser() user: AuthenticatedUser, @Param('equipmentId') equipmentId: string) {
    return this.service.listEvents(user, equipmentId)
  }

  @RequirePermissions('quality.manage_equipment')
  @Post('maintenance-records')
  recordMaintenance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('equipmentId') equipmentId: string,
    @Body() dto: CreateMaintenanceRecordDto,
    @Req() req: Request,
  ) {
    return this.service.recordMaintenance(user, equipmentId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('maintenance-records')
  listMaintenance(@CurrentUser() user: AuthenticatedUser, @Param('equipmentId') equipmentId: string) {
    return this.service.listMaintenance(user, equipmentId)
  }
}
