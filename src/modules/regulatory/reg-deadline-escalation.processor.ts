import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject } from '@nestjs/common'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegDeadlineService } from './reg-deadline.service'
import {
  REG_DEADLINE_ESCALATION_NOTIFIER,
  RegDeadlineEscalationNotifier,
} from './reg-deadline-escalation.interface'

export const REG_DEADLINE_ESCALATION_QUEUE = 'reg-deadline-escalation'

/** Daily, not hourly (`DeadlineEscalationProcessor`'s own cadence) — a renewal clock moves in months/years, an hourly scan would be pure waste. */
@Processor(REG_DEADLINE_ESCALATION_QUEUE)
export class RegDeadlineEscalationProcessor extends WorkerHost {
  constructor(
    private readonly regDeadlineService: RegDeadlineService,
    @Inject(REG_DEADLINE_ESCALATION_NOTIFIER)
    private readonly notifier: RegDeadlineEscalationNotifier,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.regDeadlineService.scanAndEscalate(this.notifier)
    this.logger.log(
      { result },
      `RegCloud deadline escalation scan complete: ${result.breached} breached, ${result.d30} approaching (30d), ${result.d90} approaching (90d), ${result.d180} approaching (180d)`,
    )
  }
}
