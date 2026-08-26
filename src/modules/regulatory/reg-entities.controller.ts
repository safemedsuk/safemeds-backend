import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateLocalRepresentativeDto } from './dto/create-local-representative.dto'
import { CreateManufacturerDto } from './dto/create-manufacturer.dto'
import { CreateManufacturingSiteDto } from './dto/create-manufacturing-site.dto'
import { ListLocalRepresentativesQueryDto } from './dto/list-local-representatives-query.dto'
import { ListManufacturersQueryDto } from './dto/list-manufacturers-query.dto'
import { ListManufacturingSitesQueryDto } from './dto/list-manufacturing-sites-query.dto'
import { UpdateLocalRepresentativeDto } from './dto/update-local-representative.dto'
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto'
import { UpdateManufacturingSiteDto } from './dto/update-manufacturing-site.dto'
import { RegEntitiesService } from './reg-entities.service'

@ApiTags('regulatory-entities')
@Controller()
@RequirePermissions('regulatory.view_all')
export class RegEntitiesController {
  constructor(private readonly regEntitiesService: RegEntitiesService) {}

  @Get('manufacturers')
  listManufacturers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListManufacturersQueryDto,
  ) {
    return this.regEntitiesService.listManufacturers(actor, query)
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('manufacturers')
  createManufacturer(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateManufacturerDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.createManufacturer(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Patch('manufacturers/:id')
  updateManufacturer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateManufacturerDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.updateManufacturer(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('manufacturers/:id/deactivate')
  deactivateManufacturer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.deactivateManufacturer(actor, id, { ip: req.ip })
  }

  @Get('manufacturing-sites')
  listManufacturingSites(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListManufacturingSitesQueryDto,
  ) {
    return this.regEntitiesService.listManufacturingSites(actor, query)
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('manufacturing-sites')
  createManufacturingSite(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateManufacturingSiteDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.createManufacturingSite(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Patch('manufacturing-sites/:id')
  updateManufacturingSite(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateManufacturingSiteDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.updateManufacturingSite(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('manufacturing-sites/:id/deactivate')
  deactivateManufacturingSite(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.deactivateManufacturingSite(actor, id, { ip: req.ip })
  }

  @Get('local-representatives')
  listLocalRepresentatives(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListLocalRepresentativesQueryDto,
  ) {
    return this.regEntitiesService.listLocalRepresentatives(actor, query)
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('local-representatives')
  createLocalRepresentative(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateLocalRepresentativeDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.createLocalRepresentative(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Patch('local-representatives/:id')
  updateLocalRepresentative(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocalRepresentativeDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.updateLocalRepresentative(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_entities')
  @Post('local-representatives/:id/deactivate')
  deactivateLocalRepresentative(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regEntitiesService.deactivateLocalRepresentative(actor, id, { ip: req.ip })
  }
}
