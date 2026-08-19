import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CaseFollowUpService } from './case-follow-up.service'
import { LogFollowUpAttemptDto } from './dto/log-follow-up-attempt.dto'

/** VigiCloud Stage 11 — the manual "log a follow-up contact" action against an already-open `CaseFollowUp`. Gated by `pv.triage_case`, same reasoning as duplicate review. */
@ApiTags('pv-case-follow-ups')
@Controller('pv/case-follow-ups')
export class CaseFollowUpController {
  constructor(private readonly caseFollowUpService: CaseFollowUpService) {}

  @RequirePermissions('pv.triage_case')
  @Post(':id/log-attempt')
  logAttempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LogFollowUpAttemptDto,
    @Req() req: Request,
  ) {
    return this.caseFollowUpService.logAttempt(user, id, dto, { ip: req.ip })
  }
}
