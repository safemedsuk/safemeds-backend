import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallRuleDto } from './dto/create-recall-rule.dto'
import { CreateRecallRuleSetDto } from './dto/create-recall-rule-set.dto'
import { CreateRecallSubmissionTemplateDto } from './dto/create-recall-submission-template.dto'
import { UpdateRecallRuleDto } from './dto/update-recall-rule.dto'
import { RecallRuleSetService } from './recall-rule-set.service'

/**
 * QualCloud (Phase 13) Stage 10.1 — platform-admin CRUD + sign-off over
 * the recall country rules engine, mirroring `/admin/country-rules`'s
 * own precedent exactly. `platform.recall_rules.manage` only — held by
 * the platform `regulatory_lead` role, never a tenant-side permission.
 */
@ApiTags('recall-rule-sets')
@Controller('recall-rule-sets')
export class RecallRuleSetController {
  constructor(private readonly recallRuleSetService: RecallRuleSetService) {}

  @RequirePermissions('platform.recall_rules.manage')
  @Get()
  list(@Query('countryId') countryId?: string) {
    return this.recallRuleSetService.list(countryId)
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.recallRuleSetService.get(id)
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRecallRuleSetDto,
    @Req() req: Request,
  ) {
    return this.recallRuleSetService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Post(':id/rules')
  addRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRecallRuleDto,
    @Req() req: Request,
  ) {
    return this.recallRuleSetService.addRule(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Patch('rules/:ruleId')
  updateRule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRecallRuleDto,
    @Req() req: Request,
  ) {
    return this.recallRuleSetService.updateRule(actor, ruleId, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Post(':id/submission-templates')
  addSubmissionTemplate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateRecallSubmissionTemplateDto,
    @Req() req: Request,
  ) {
    return this.recallRuleSetService.addSubmissionTemplate(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.recall_rules.manage')
  @Post(':id/sign-off')
  signOff(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallRuleSetService.signOff(actor, id, { ip: req.ip })
  }
}
