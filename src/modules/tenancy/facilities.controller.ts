import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateFacilityDto } from './dto/create-facility.dto'
import { ListFacilitiesQueryDto } from './dto/list-facilities-query.dto'
import { UpdateFacilityDto } from './dto/update-facility.dto'
import { UpdateFacilityLicenceDto } from './dto/update-facility-licence.dto'
import { FacilitiesService } from './facilities.service'

@ApiTags('facilities')
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilitiesService: FacilitiesService) {}

  /** Any authenticated company member can read the company's own location list. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListFacilitiesQueryDto) {
    return this.facilitiesService.list(user, query)
  }

  /** Stage 0.8 two-altitude dashboard: full company view if unrestricted, else only the caller's scoped facilities. */
  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.facilitiesService.overview(user)
  }

  @RequirePermissions('company_profile.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFacilityDto,
    @Req() req: Request,
  ) {
    return this.facilitiesService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('company_profile.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFacilityDto,
    @Req() req: Request,
  ) {
    return this.facilitiesService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('company_profile.manage')
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.facilitiesService.deactivate(user, id, { ip: req.ip })
  }

  /** RegCloud (Phase 12) Stage 10 — a deliberately separate permission from the rest of this controller, see `FacilitiesService.updateLicence()`'s own doc comment. */
  @RequirePermissions('regulatory.manage_licensing')
  @Patch(':id/licence')
  updateLicence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFacilityLicenceDto,
    @Req() req: Request,
  ) {
    return this.facilitiesService.updateLicence(user, id, dto, { ip: req.ip })
  }
}
