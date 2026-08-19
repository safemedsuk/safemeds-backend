import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { CaseFollowUpService } from './case-follow-up.service'

export const CASE_FOLLOW_UP_QUEUE = 'pv-case-follow-up'

/** VigiCloud Stage 11 — the daily sweep: attempt timeouts, the 28-day hard ceiling, and the `PregnancyContext.followUpDueAt` trigger. Mirrors `DuplicateScreeningProcessor`'s exact shape. */
@Processor(CASE_FOLLOW_UP_QUEUE)
export class CaseFollowUpProcessor extends WorkerHost {
  constructor(
    private readonly followUpService: CaseFollowUpService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.followUpService.processDue()
    this.logger.log(
      { result },
      `Case follow-up sweep complete: ${result.attemptsTimedOut} attempt(s) timed out, ${result.hardClosed} force-closed at the 28-day ceiling, ${result.pregnancyTriggered} pregnancy-due follow-up(s) started, across ${result.companiesScanned} compan(y/ies)`,
    )
  }
}
