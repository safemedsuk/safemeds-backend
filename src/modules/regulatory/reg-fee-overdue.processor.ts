import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegFeeLedgerService } from './reg-fee-ledger.service'

export const REG_FEE_OVERDUE_QUEUE = 'reg-fee-overdue'

/** Daily — an invoice's due date moves in weeks, not hours; matches `RegDeadlineEscalationProcessor`'s own cadence reasoning. */
@Processor(REG_FEE_OVERDUE_QUEUE)
export class RegFeeOverdueProcessor extends WorkerHost {
  constructor(
    private readonly regFeeLedgerService: RegFeeLedgerService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.regFeeLedgerService.scanAndFlagOverdue()
    this.logger.log(
      { result },
      `RegCloud fee-overdue scan complete: ${result.flagged} invoice(s) flagged overdue`,
    )
  }
}
