import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GenerateRecallSubmissionDto } from './dto/generate-recall-submission.dto'
import { MarkRecallSubmissionSubmittedDto } from './dto/mark-recall-submission-submitted.dto'
import { RecallSubmissionService } from './recall-submission.service'

@ApiTags('recall-submissions')
@Controller()
export class RecallSubmissionController {
  constructor(private readonly recallSubmissionService: RecallSubmissionService) {}

  @RequirePermissions('quality.view_all')
  @Get('recall-countries/:id/submissions')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallSubmissionService.list(actor, id)
  }

  // 10.8's own mapping: SUBMISSION.GENERATE / regulator-facing report
  // ownership stays with REGULATORY_AFFAIRS_OFFICER (unchanged) —
  // generating and marking a regulator submission is a materially
  // different action from the rest of this module's QualCloud-owned
  // recall case management, even though `list()` above stays visible
  // to Quality too (`quality.view_all`, matching every other read on
  // this recall).
  @RequirePermissions('regulatory.manage_recalls')
  @Post('recall-countries/:id/submissions')
  generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GenerateRecallSubmissionDto,
    @Req() req: Request,
  ) {
    return this.recallSubmissionService.generate(actor, id, dto.templateId, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_recalls')
  @Post('recall-submissions/:id/mark-submitted')
  markSubmitted(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MarkRecallSubmissionSubmittedDto,
    @Req() req: Request,
  ) {
    return this.recallSubmissionService.markSubmitted(actor, id, dto.submittedProofDocumentId, {
      ip: req.ip,
    })
  }
}
