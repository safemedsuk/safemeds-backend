import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateInspectionChecklistTemplateDto } from './dto/create-inspection-checklist-template.dto'
import { UpdateInspectionChecklistTemplateDto } from './dto/update-inspection-checklist-template.dto'
import { InspectionChecklistService } from './inspection-checklist.service'

/**
 * QualCloud (Phase 13) Stage 9 — platform-admin CRUD over the shared
 * checklist catalog, mirroring `GovernanceController`'s own
 * `requirement-definitions` routes exactly (open read, `platform.config.manage`-gated write).
 */
@ApiTags('inspection-checklist')
@Controller('inspection-checklist-templates')
export class InspectionChecklistController {
  constructor(private readonly inspectionChecklistService: InspectionChecklistService) {}

  @Get()
  list(@Query('authorityId') authorityId?: string) {
    return this.inspectionChecklistService.list(authorityId)
  }

  @RequirePermissions('platform.config.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateInspectionChecklistTemplateDto,
    @Req() req: Request,
  ) {
    return this.inspectionChecklistService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInspectionChecklistTemplateDto,
    @Req() req: Request,
  ) {
    return this.inspectionChecklistService.update(actor, id, dto, { ip: req.ip })
  }
}
