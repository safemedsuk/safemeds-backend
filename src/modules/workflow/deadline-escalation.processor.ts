import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Inject } from '@nestjs/common'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { DeadlineService } from './deadline.service'
import {
  DEADLINE_ESCALATION_NOTIFIER,
  DeadlineEscalationNotifier,
} from './deadline-escalation.interface'

export const DEADLINE_ESCALATION_QUEUE = 'deadline-escalation'

@Processor(DEADLINE_ESCALATION_QUEUE)
export class DeadlineEscalationProcessor extends WorkerHost {
  constructor(
    private readonly deadlineService: DeadlineService,
    @Inject(DEADLINE_ESCALATION_NOTIFIER) private readonly notifier: DeadlineEscalationNotifier,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.deadlineService.scanAndEscalate(this.notifier)
    this.logger.log(
      { result },
      `Deadline escalation scan complete: ${result.breached} breached, ${result.t24} approaching (24h), ${result.t72} approaching (72h)`,
    )
  }
}
