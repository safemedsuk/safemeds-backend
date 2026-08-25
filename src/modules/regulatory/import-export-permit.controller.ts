import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateImportExportPermitDto } from './dto/create-import-export-permit.dto'
import { ListImportExportPermitsQueryDto } from './dto/list-import-export-permits-query.dto'
import { UpdateImportExportPermitDto } from './dto/update-import-export-permit.dto'
import { ImportExportPermitService } from './import-export-permit.service'

@ApiTags('import-export-permits')
@Controller('import-export-permits')
@RequirePermissions('regulatory.view_all')
export class ImportExportPermitController {
  constructor(private readonly service: ImportExportPermitService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListImportExportPermitsQueryDto) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_import_export')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateImportExportPermitDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_import_export')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateImportExportPermitDto,
    @Req() req: Request,
  ) {
    return this.service.update(actor, id, dto, { ip: req.ip })
  }
}
