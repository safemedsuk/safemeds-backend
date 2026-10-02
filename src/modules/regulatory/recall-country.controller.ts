import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallCountryDto } from './dto/create-recall-country.dto'
import { UpdateRecallCountryDto } from './dto/update-recall-country.dto'
import { UpdateRecallRequirementDto } from './dto/update-recall-requirement.dto'
import { RecallCountryService } from './recall-country.service'

@ApiTags('recall-countries')
@Controller()
export class RecallCountryController {
  constructor(private readonly recallCountryService: RecallCountryService) {}

  @RequirePermissions('quality.view_all')
  @Get('recalls/:recallId/countries')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallCountryService.list(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('recalls/:recallId/countries')
  addCountry(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallCountryDto,
    @Req() req: Request,
  ) {
    return this.recallCountryService.addCountry(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Patch('recall-countries/:id')
  updateCountry(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRecallCountryDto,
    @Req() req: Request,
  ) {
    return this.recallCountryService.updateCountry(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-countries/:id/re-evaluate')
  reEvaluate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallCountryService.evaluateForCountry(actor, id, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('recall-countries/:id/requirements')
  listRequirements(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallCountryService.listRequirements(actor, id)
  }

  @RequirePermissions('quality.log_recall')
  @Patch('recall-requirements/:id')
  updateRequirement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRecallRequirementDto,
    @Req() req: Request,
  ) {
    return this.recallCountryService.updateRequirement(actor, id, dto, { ip: req.ip })
  }
}
