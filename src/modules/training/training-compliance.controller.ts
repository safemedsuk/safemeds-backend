import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateCompetencyAssessmentDto } from './dto/competency-assessment.dto'
import { CreateRoleTrainingCurriculumDto } from './dto/role-training-curriculum.dto'
import { TrainingComplianceService } from './training-compliance.service'

@ApiTags('training-compliance')
@Controller('training')
export class TrainingComplianceController {
  constructor(private readonly service: TrainingComplianceService) {}

  @RequirePermissions('training.manage')
  @Post('curriculum')
  createCurriculum(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRoleTrainingCurriculumDto,
    @Req() req: Request,
  ) {
    return this.service.createCurriculum(user, dto, { ip: req.ip })
  }

  @RequirePermissions('training.view')
  @Get('curriculum')
  listCurriculum(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listCurriculum(user)
  }

  @RequirePermissions('training.manage')
  @Delete('curriculum/:id')
  removeCurriculum(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.removeCurriculum(user, id, { ip: req.ip })
  }

  @RequirePermissions('training.view')
  @Get('compliance/:userId')
  getComplianceStatus(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.service.getComplianceStatus(user, userId)
  }

  @RequirePermissions('training.manage')
  @Post('competency-assessments')
  recordCompetencyAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompetencyAssessmentDto,
    @Req() req: Request,
  ) {
    return this.service.recordCompetencyAssessment(user, dto, { ip: req.ip })
  }

  @RequirePermissions('training.view')
  @Get('training-records/:trainingRecordId/competency-assessments')
  listCompetencyAssessments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('trainingRecordId') trainingRecordId: string,
  ) {
    return this.service.listCompetencyAssessments(user, trainingRecordId)
  }
}
