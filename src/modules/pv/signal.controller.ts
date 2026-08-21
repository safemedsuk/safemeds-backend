import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateSignalDto } from './dto/create-signal.dto'
import { RecordSignalAssessmentDto } from './dto/record-signal-assessment.dto'
import { RecordSignalPrioritisationDto } from './dto/record-signal-prioritisation.dto'
import { RecordSignalRecommendationDto } from './dto/record-signal-recommendation.dto'
import { RecordSignalValidationDto } from './dto/record-signal-validation.dto'
import { SignalService } from './signal.service'
import { SignalDetectionService } from './signal-detection.service'

@ApiTags('pv-signals')
@Controller('pv/signals')
export class SignalController {
  constructor(
    private readonly signalService: SignalService,
    private readonly signalDetectionService: SignalDetectionService,
  ) {}

  @RequirePermissions('pv.manage_signals')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSignalDto,
    @Req() req: Request,
  ) {
    return this.signalService.create(user, dto, { ip: req.ip })
  }

  // No `@RequirePermissions` here — see `SignalService.requireReadAccess()`'s own doc comment, matching `DistributorController`'s identical precedent.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.signalService.list(user)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.signalService.get(user, id)
  }

  @RequirePermissions('pv.manage_signals')
  @Post(':id/link-cases')
  linkCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('caseIds') caseIds: string[],
    @Req() req: Request,
  ) {
    return this.signalService.linkCases(user, id, caseIds, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_signals')
  @Post(':id/validation')
  recordValidation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordSignalValidationDto,
    @Req() req: Request,
  ) {
    return this.signalService.recordValidation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_signals')
  @Post(':id/prioritisation')
  recordPrioritisation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordSignalPrioritisationDto,
    @Req() req: Request,
  ) {
    return this.signalService.recordPrioritisation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_signals')
  @Post(':id/assessment')
  recordAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordSignalAssessmentDto,
    @Req() req: Request,
  ) {
    return this.signalService.recordAssessment(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_signals')
  @Post(':id/recommendation')
  recordRecommendation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordSignalRecommendationDto,
    @Req() req: Request,
  ) {
    return this.signalService.recordRecommendation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.manage_signals')
  @Post('scan')
  scanNow(@CurrentUser() user: AuthenticatedUser) {
    if (!user.companyId) {
      return { signalsCreated: 0, casesLinked: 0 }
    }
    return this.signalDetectionService.scanCompany(user.companyId)
  }
}
