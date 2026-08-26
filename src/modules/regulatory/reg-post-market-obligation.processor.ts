import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegPostMarketObligationService } from './reg-post-market-obligation.service'

export const REG_POST_MARKET_OBLIGATION_QUEUE = 'reg-post-market-obligation'

/** Daily — an obligation cadence moves in months/years, not hours; matches `RegFeeOverdueProcessor`/`RegDeadlineEscalationProcessor`'s own cadence reasoning. Does both halves in one pass: backfill first (a newly-activated rule should start tracking immediately, before this same run's overdue scan sees it), then flag overdue. */
@Processor(REG_POST_MARKET_OBLIGATION_QUEUE)
export class RegPostMarketObligationProcessor extends WorkerHost {
  constructor(
    private readonly service: RegPostMarketObligationService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const backfill = await this.service.backfillAllActiveRegistrations()
    const overdue = await this.service.scanAndFlagOverdue()
    this.logger.log(
      { backfill, overdue },
      `RegCloud post-market-obligation scan complete: ${backfill.scanned} registration(s) scanned, ${backfill.created} obligation(s) backfilled, ${overdue.flagged} flagged overdue`,
    )
  }
}
