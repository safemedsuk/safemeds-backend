import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BuildReportQueryDto } from './dto/build-report-query.dto'
import { SaveReportDefinitionDto } from './dto/save-report-definition.dto'
import { ReportBuilderService } from './report-builder.service'

/**
 * Real-usage request, 11 Sep 2026 — the self-service report builder.
 * Reuses the existing generic `reports.view`/`reports.manage`
 * permissions (this is conceptually still part of "Reports," not a
 * separate feature needing its own RBAC grant) rather than adding new
 * permission keys for a feature that's an extension of the same screen.
 */
@ApiTags('report-builder')
@Controller('report-builder')
export class ReportBuilderController {
  constructor(private readonly reportBuilderService: ReportBuilderService) {}

  @RequirePermissions('reports.view')
  @Get('data-sources')
  listDataSources() {
    return this.reportBuilderService.listDataSources()
  }

  @RequirePermissions('reports.view')
  @Post('preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: BuildReportQueryDto) {
    return this.reportBuilderService.preview(user, dto)
  }

  @RequirePermissions('reports.manage')
  @Post('definitions')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveReportDefinitionDto,
    @Req() req: Request,
  ) {
    return this.reportBuilderService.save(user, dto, { ip: req.ip })
  }

  @RequirePermissions('reports.view')
  @Get('definitions')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reportBuilderService.list(user)
  }

  @RequirePermissions('reports.view')
  @Get('definitions/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reportBuilderService.get(user, id)
  }

  @RequirePermissions('reports.manage')
  @Delete('definitions/:id')
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportBuilderService.delete(user, id, { ip: req.ip })
  }

  @RequirePermissions('reports.manage')
  @Post('definitions/:id/export')
  runExport(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportBuilderService.runExport(user, id, { ip: req.ip })
  }
}
