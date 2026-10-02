import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateEquipmentDto } from './dto/create-equipment.dto'
import { ListEquipmentQueryDto } from './dto/list-equipment-query.dto'
import { UpdateEquipmentDto } from './dto/update-equipment.dto'
import { EquipmentService } from './equipment.service'

@ApiTags('quality-equipment')
@Controller('quality/equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEquipmentQueryDto) {
    return this.equipmentService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.equipmentService.get(user, id)
  }

  @RequirePermissions('quality.manage_equipment')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEquipmentDto,
    @Req() req: Request,
  ) {
    return this.equipmentService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_equipment')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
    @Req() req: Request,
  ) {
    return this.equipmentService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_equipment')
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.equipmentService.deactivate(user, id, { ip: req.ip })
  }
}
