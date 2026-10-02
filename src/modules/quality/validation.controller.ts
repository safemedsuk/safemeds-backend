import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateValidationProtocolDto } from './dto/create-validation-protocol.dto'
import { CreateValidationReportDto } from './dto/create-validation-report.dto'
import { FinalizeValidationReportDto } from './dto/finalize-validation-report.dto'
import { ListValidationProtocolsQueryDto } from './dto/list-validation-protocols-query.dto'
import { ValidationService } from './validation.service'

@ApiTags('quality-validation')
@Controller('quality/validation-protocols')
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  listProtocols(@CurrentUser() user: AuthenticatedUser, @Query() query: ListValidationProtocolsQueryDto) {
    return this.validationService.listProtocols(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  getProtocol(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.validationService.getProtocol(user, id)
  }

  // Drafting a protocol is a controlled-document action — `quality.manage_documents`,
  // same permission `SopController`/`SpecificationController` already use.
  @RequirePermissions('quality.manage_documents')
  @Post()
  createProtocol(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateValidationProtocolDto,
    @Req() req: Request,
  ) {
    return this.validationService.createProtocol(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get(':protocolId/reports')
  listReports(@CurrentUser() user: AuthenticatedUser, @Param('protocolId') protocolId: string) {
    return this.validationService.listReportsForProtocol(user, protocolId)
  }

  // Recording execution and the validated/not-validated conclusion is
  // the senior, sign-off-shaped action — `quality.manage_validation`
  // (QUALITY_MANAGER-only, already seeded since Stage 0).
  @RequirePermissions('quality.manage_validation')
  @Post(':protocolId/reports')
  createReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('protocolId') protocolId: string,
    @Body() dto: CreateValidationReportDto,
    @Req() req: Request,
  ) {
    return this.validationService.createReport(user, protocolId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_validation')
  @Post('reports/:id/finalize')
  finalizeReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FinalizeValidationReportDto,
    @Req() req: Request,
  ) {
    return this.validationService.finalizeReport(user, id, dto, { ip: req.ip })
  }
}
