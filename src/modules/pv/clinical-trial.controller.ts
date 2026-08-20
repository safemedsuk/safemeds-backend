import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ClinicalTrialService } from './clinical-trial.service'
import { CreateClinicalTrialDto } from './dto/create-clinical-trial.dto'
import { EnrollTrialSubjectDto } from './dto/enroll-trial-subject.dto'
import { ListClinicalTrialSubjectsQueryDto } from './dto/list-clinical-trial-subjects-query.dto'
import { ListClinicalTrialsQueryDto } from './dto/list-clinical-trials-query.dto'
import { RevealTreatmentArmDto } from './dto/reveal-treatment-arm.dto'
import { UpdateClinicalTrialDto } from './dto/update-clinical-trial.dto'

@ApiTags('clinical-trials')
@Controller('pv/clinical-trials')
export class ClinicalTrialController {
  constructor(private readonly clinicalTrialService: ClinicalTrialService) {}

  @RequirePermissions('pv.manage_clinical_trials')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClinicalTrialDto,
    @Req() req: Request,
  ) {
    return this.clinicalTrialService.create(user, dto, { ip: req.ip })
  }

  // No @RequirePermissions here — see `ClinicalTrialService.requireReadAccess()`'s
  // own doc comment for why this is a service-level OR check instead.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListClinicalTrialsQueryDto) {
    return this.clinicalTrialService.list(user, query)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.clinicalTrialService.get(user, id)
  }

  @Get(':id/subjects')
  listSubjects(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ListClinicalTrialSubjectsQueryDto,
  ) {
    return this.clinicalTrialService.listSubjects(user, id, query)
  }

  @RequirePermissions('pv.manage_clinical_trials')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateClinicalTrialDto,
    @Req() req: Request,
  ) {
    return this.clinicalTrialService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_clinical_trials')
  @Post(':id/subjects')
  enrollSubject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EnrollTrialSubjectDto,
    @Req() req: Request,
  ) {
    return this.clinicalTrialService.enrollSubject(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.unblind_treatment')
  @Post('subjects/:subjectId/reveal-treatment-arm')
  revealTreatmentArm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId') subjectId: string,
    @Body() dto: RevealTreatmentArmDto,
    @Req() req: Request,
  ) {
    return this.clinicalTrialService.revealTreatmentArm(user, subjectId, dto, { ip: req.ip })
  }
}
