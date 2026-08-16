import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { CapaService } from './capa.service'
import { CreateCapaDto } from './dto/create-capa.dto'
import { RecordCapaEffectivenessDto } from './dto/record-capa-effectiveness.dto'
import { UpdateCapaDto } from './dto/update-capa.dto'

@ApiTags('capas')
@Controller('capas')
export class CapaController {
  constructor(private readonly capaService: CapaService) {}

  @RequirePermissions('quality.manage_capa')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCapaDto, @Req() req: Request) {
    return this.capaService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.capaService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.capaService.get(user, id)
  }

  @RequirePermissions('quality.manage_capa')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCapaDto,
    @Req() req: Request,
  ) {
    return this.capaService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/effectiveness-check')
  recordEffectivenessCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordCapaEffectivenessDto,
    @Req() req: Request,
  ) {
    return this.capaService.recordEffectivenessCheck(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/close')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.capaService.close(user, id, { ip: req.ip })
  }
}
