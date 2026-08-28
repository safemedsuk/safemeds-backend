import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreatePersonnelLicenceDto } from './dto/create-personnel-licence.dto'
import { ListPersonnelLicencesQueryDto } from './dto/list-personnel-licences-query.dto'
import { UpdatePersonnelLicenceDto } from './dto/update-personnel-licence.dto'
import { PersonnelLicenceService } from './personnel-licence.service'

@ApiTags('personnel-licences')
@Controller('personnel-licences')
@RequirePermissions('regulatory.view_all')
export class PersonnelLicenceController {
  constructor(private readonly service: PersonnelLicenceService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListPersonnelLicencesQueryDto) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_licensing')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreatePersonnelLicenceDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_licensing')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePersonnelLicenceDto,
    @Req() req: Request,
  ) {
    return this.service.update(actor, id, dto, { ip: req.ip })
  }
}
