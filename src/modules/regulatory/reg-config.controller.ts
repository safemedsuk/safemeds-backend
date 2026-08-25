import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRegDeadlineRuleDto } from './dto/create-reg-deadline-rule.dto'
import { CreateRegulatoryFeeScheduleDto } from './dto/create-regulatory-fee-schedule.dto'
import { CreateRegulatoryRequirementDto } from './dto/create-regulatory-requirement.dto'
import { ListRegConfigQueryDto } from './dto/list-reg-config-query.dto'
import { RegConfigService } from './reg-config.service'

/**
 * RegCloud (Phase 12) Stage 0.1 — the country rule-set graph's admin
 * surface. GET endpoints are open to any authenticated user (matching
 * `CountryConfigController`'s own precedent — a tenant needs to read this
 * to classify a registration, per Stage 1's `ClassificationService`);
 * every write is `platform.config.manage`, the exact same permission
 * `regulatory_lead` (the field-expert platform role) already holds and the
 * Admin Configuration Console's other three gaps already reused — no new
 * permission needed for this, deliberately (see `todo-regcloud.md`'s own
 * Stage 0.1 note on this decision).
 */
@ApiTags('regulatory-config')
@Controller('regulatory-config')
export class RegConfigController {
  constructor(private readonly regConfigService: RegConfigService) {}

  @Get('requirements')
  listRequirements(@Query() query: ListRegConfigQueryDto) {
    return this.regConfigService.listRequirements(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('requirements')
  createRequirementVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegulatoryRequirementDto,
    @Req() req: Request,
  ) {
    return this.regConfigService.createRequirementVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('requirements/:id/activate')
  activateRequirement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regConfigService.activateRequirement(actor, id, { ip: req.ip })
  }

  @Get('requirements/resolve')
  resolveRequirement(
    @Query('countryId') countryId: string,
    @Query('authorityId') authorityId: string,
    @Query('productClass') productClass: string,
    @Query('route') route?: string,
  ) {
    return this.regConfigService.resolveRequirement(
      countryId,
      authorityId,
      productClass,
      route ?? '*',
    )
  }

  @Get('fee-schedules')
  listFeeSchedules(@Query() query: ListRegConfigQueryDto) {
    return this.regConfigService.listFeeSchedules(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('fee-schedules')
  createFeeScheduleVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegulatoryFeeScheduleDto,
    @Req() req: Request,
  ) {
    return this.regConfigService.createFeeScheduleVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('fee-schedules/:id/activate')
  activateFeeSchedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regConfigService.activateFeeSchedule(actor, id, { ip: req.ip })
  }

  @Get('fee-schedules/resolve')
  resolveFeeSchedules(
    @Query('countryId') countryId: string,
    @Query('authorityId') authorityId: string,
    @Query('productClass') productClass: string,
    @Query('route') route?: string,
  ) {
    return this.regConfigService.resolveFeeSchedules(
      countryId,
      authorityId,
      productClass,
      route ?? '*',
    )
  }

  @Get('deadline-rules')
  listDeadlineRules(@Query() query: ListRegConfigQueryDto) {
    return this.regConfigService.listDeadlineRules(query)
  }

  @RequirePermissions('platform.config.manage')
  @Post('deadline-rules')
  createDeadlineRuleVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegDeadlineRuleDto,
    @Req() req: Request,
  ) {
    return this.regConfigService.createDeadlineRuleVersion(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Post('deadline-rules/:id/activate')
  activateDeadlineRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.regConfigService.activateDeadlineRule(actor, id, { ip: req.ip })
  }
}
