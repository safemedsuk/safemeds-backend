import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AuditPackService } from './audit-pack.service'
import { AuditReadinessService } from './audit-readiness.service'
import { CreateRequirementDefinitionDto } from './dto/create-requirement-definition.dto'
import { UpdateAuditRequirementDto } from './dto/update-audit-requirement.dto'
import { UpdateRequirementDefinitionDto } from './dto/update-requirement-definition.dto'
import { RequirementDefinitionAdminService } from './requirement-definition-admin.service'

@ApiTags('governance')
@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly auditReadinessService: AuditReadinessService,
    private readonly auditPackService: AuditPackService,
    private readonly requirementDefinitionAdminService: RequirementDefinitionAdminService,
  ) {}

  // ── Admin Configuration Console — Gap 3 — the shared 15-row catalog
  // itself, distinct from the per-company evidence rows below. Platform-
  // gated (`platform.config.manage`), never `governance.manage` — a
  // definition edit affects every company under that authority at once,
  // the same blast radius `platform.config.manage` already covers
  // elsewhere in this domain (`ReportingRule`, `RegulatoryAuthority`).

  /** Open read — same treatment as `GET /country-config/*` and `GET /regulatory-authorities`. */
  @Get('requirement-definitions')
  listRequirementDefinitions(@Query('authorityId') authorityId?: string) {
    return this.requirementDefinitionAdminService.list(authorityId)
  }

  @RequirePermissions('platform.config.manage')
  @Post('requirement-definitions')
  createRequirementDefinition(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRequirementDefinitionDto,
    @Req() req: Request,
  ) {
    return this.requirementDefinitionAdminService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Patch('requirement-definitions/:id')
  updateRequirementDefinition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDefinitionDto,
    @Req() req: Request,
  ) {
    return this.requirementDefinitionAdminService.update(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('governance.view')
  @Get('audit-readiness')
  getDashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.auditReadinessService.getDashboard(user)
  }

  @RequirePermissions('governance.manage')
  @Patch('audit-readiness/:definitionId')
  updateRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('definitionId') definitionId: string,
    @Body() dto: UpdateAuditRequirementDto,
    @Req() req: Request,
  ) {
    return this.auditReadinessService.updateRecord(user, definitionId, dto, { ip: req.ip })
  }

  /** Bypasses the global `TransformInterceptor` via `@Res()` — same precedent as `CompanyProfileController.getPublicReportingQrCode()` — since this returns a raw CSV file, not `{ data }`-shaped JSON. */
  @RequirePermissions('governance.view')
  @Get('ae-log/export')
  async exportAeLog(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const csv = await this.auditReadinessService.exportAeLogCsv(user)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="ae-log.csv"')
    res.send(csv)
  }

  @RequirePermissions('governance.manage')
  @Post('audit-packs')
  generateAuditPack(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.auditPackService.generate(user, { ip: req.ip })
  }

  @RequirePermissions('governance.view')
  @Get('audit-packs')
  listAuditPacks(@CurrentUser() user: AuthenticatedUser) {
    return this.auditPackService.list(user)
  }

  @RequirePermissions('governance.view')
  @Get('audit-packs/:id')
  getAuditPack(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.auditPackService.get(user, id)
  }
}
