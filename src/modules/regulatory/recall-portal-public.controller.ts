import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { Public } from '../../common/decorators/public.decorator'
import { SubmitRecallPortalActionDto } from './dto/submit-recall-portal-action.dto'
import { RecallPortalService } from './recall-portal.service'

/**
 * QualCloud (Phase 13) Stage 10.4 — fully unauthenticated, token-scoped
 * external stakeholder portal endpoints, mirroring
 * `PublicReportingController`'s own precedent exactly (`@Public()`,
 * meaningfully throttled — this is genuinely open to the internet with
 * no account behind it).
 */
@ApiTags('recall-portal-public')
@Controller('recall-portal')
export class RecallPortalPublicController {
  constructor(private readonly recallPortalService: RecallPortalService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get(':token/context')
  resolveContext(@Param('token') token: string) {
    return this.recallPortalService.resolveContext(token)
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post(':token/actions')
  submitAction(@Param('token') token: string, @Body() dto: SubmitRecallPortalActionDto) {
    return this.recallPortalService.submitAction(token, dto)
  }
}
