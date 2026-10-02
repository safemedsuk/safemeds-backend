import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateWasteDisposalRecordDto } from './dto/create-waste-disposal-record.dto'
import { ListWasteDisposalRecordsQueryDto } from './dto/list-waste-disposal-records-query.dto'
import { UpsertWasteDisposalMethodDto } from './dto/upsert-waste-disposal-method.dto'
import { WitnessWasteDisposalDto } from './dto/witness-waste-disposal.dto'
import { WasteDisposalService } from './waste-disposal.service'
import { WasteDisposalMethodCatalogService } from './waste-disposal-method-catalog.service'

@ApiTags('quality-waste-disposal')
@Controller('quality/waste-disposal')
export class WasteDisposalController {
  constructor(private readonly wasteDisposalService: WasteDisposalService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWasteDisposalRecordsQueryDto) {
    return this.wasteDisposalService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.wasteDisposalService.get(user, id)
  }

  @RequirePermissions('quality.manage_waste_disposal')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWasteDisposalRecordDto,
    @Req() req: Request,
  ) {
    return this.wasteDisposalService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/witness')
  recordWitness(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: WitnessWasteDisposalDto,
    @Req() req: Request,
  ) {
    return this.wasteDisposalService.recordWitness(user, id, dto, { ip: req.ip })
  }
}

/** Admin-editable catalog, gated `platform.config.manage` — mirrors `AuditRequirementDefinition`/`InspectionChecklistTemplate`'s own precedent. */
@ApiTags('platform-waste-disposal-methods')
@Controller('platform/waste-disposal-methods')
export class WasteDisposalMethodCatalogController {
  constructor(private readonly catalogService: WasteDisposalMethodCatalogService) {}

  @RequirePermissions('platform.config.manage')
  @Get()
  list() {
    return this.catalogService.list()
  }

  @RequirePermissions('platform.config.manage')
  @Post()
  upsert(@Body() dto: UpsertWasteDisposalMethodDto) {
    return this.catalogService.upsert(dto)
  }

  @RequirePermissions('platform.config.manage')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.catalogService.deactivate(id)
  }
}

/** The tenant-facing read of the active catalog — any quality user can read it to populate a dropdown. */
@ApiTags('quality-waste-disposal-methods')
@Controller('quality/waste-disposal-methods')
export class WasteDisposalMethodCatalogReadController {
  constructor(private readonly catalogService: WasteDisposalMethodCatalogService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  listActive() {
    return this.catalogService.listActive()
  }
}
