import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CountryConfigService } from './country-config.service'
import { CreateFormSchemaDto } from './dto/create-form-schema.dto'
import { CreateReportingRuleDto } from './dto/create-reporting-rule.dto'
import { CreateSeriousnessDefinitionDto } from './dto/create-seriousness-definition.dto'
import { CreateSubmissionFormatDto } from './dto/create-submission-format.dto'
import { ListConfigQueryDto } from './dto/list-config-query.dto'

@ApiTags('country-config')
@Controller('country-config')
export class CountryConfigController {
  constructor(private readonly countryConfigService: CountryConfigService) {}

  @Get('reporting-rules')
  listReportingRules(@Query() query: ListConfigQueryDto) {
    return this.countryConfigService.listReportingRules(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('reporting-rules')
  createReportingRuleVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateReportingRuleDto,
    @Req() req: Request,
  ) {
    return this.countryConfigService.createReportingRuleVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('reporting-rules/:id/activate')
  activateReportingRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.countryConfigService.activateReportingRule(actor, id, { ip: req.ip })
  }

  @Get('seriousness-definitions')
  listSeriousnessDefinitions(@Query() query: ListConfigQueryDto) {
    return this.countryConfigService.listSeriousnessDefinitions(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('seriousness-definitions')
  createSeriousnessDefinitionVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateSeriousnessDefinitionDto,
    @Req() req: Request,
  ) {
    return this.countryConfigService.createSeriousnessDefinitionVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('seriousness-definitions/:id/activate')
  activateSeriousnessDefinition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.countryConfigService.activateSeriousnessDefinition(actor, id, { ip: req.ip })
  }

  @Get('form-schemas')
  listFormSchemas(@Query() query: ListConfigQueryDto) {
    return this.countryConfigService.listFormSchemas(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('form-schemas')
  createFormSchemaVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateFormSchemaDto,
    @Req() req: Request,
  ) {
    return this.countryConfigService.createFormSchemaVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('form-schemas/:id/activate')
  activateFormSchema(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.countryConfigService.activateFormSchema(actor, id, { ip: req.ip })
  }

  @Get('submission-formats')
  listSubmissionFormats(@Query() query: ListConfigQueryDto) {
    return this.countryConfigService.listSubmissionFormats(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('submission-formats')
  createSubmissionFormatVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateSubmissionFormatDto,
    @Req() req: Request,
  ) {
    return this.countryConfigService.createSubmissionFormatVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('submission-formats/:id/activate')
  activateSubmissionFormat(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.countryConfigService.activateSubmissionFormat(actor, id, { ip: req.ip })
  }
}
