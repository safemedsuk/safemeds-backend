import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRiskAssessmentDto } from './dto/create-risk-assessment.dto'
import { ListRiskAssessmentsQueryDto } from './dto/list-risk-assessments-query.dto'
import { UpdateRiskAssessmentDto } from './dto/update-risk-assessment.dto'
import { RiskAssessmentService } from './risk-assessment.service'

@ApiTags('quality-risk-assessments')
@Controller('quality/risk-assessments')
export class RiskAssessmentController {
  constructor(private readonly riskAssessmentService: RiskAssessmentService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListRiskAssessmentsQueryDto) {
    return this.riskAssessmentService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.riskAssessmentService.get(user, id)
  }

  @RequirePermissions('quality.manage_capa')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRiskAssessmentDto,
    @Req() req: Request,
  ) {
    return this.riskAssessmentService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRiskAssessmentDto,
    @Req() req: Request,
  ) {
    return this.riskAssessmentService.update(user, id, dto, { ip: req.ip })
  }
}
