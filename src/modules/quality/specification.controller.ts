import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateSpecificationDto } from './dto/create-specification.dto'
import { ListSpecificationsQueryDto } from './dto/list-specifications-query.dto'
import { UpdateSpecificationDto } from './dto/update-specification.dto'
import { SpecificationService } from './specification.service'

@ApiTags('quality-specifications')
@Controller('quality/specifications')
export class SpecificationController {
  constructor(private readonly specificationService: SpecificationService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSpecificationsQueryDto) {
    return this.specificationService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.specificationService.get(user, id)
  }

  @RequirePermissions('quality.manage_documents')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSpecificationDto,
    @Req() req: Request,
  ) {
    return this.specificationService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_documents')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSpecificationDto,
    @Req() req: Request,
  ) {
    return this.specificationService.update(user, id, dto, { ip: req.ip })
  }
}
