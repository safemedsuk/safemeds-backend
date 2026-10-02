import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegQueryReminderService } from './reg-query-reminder.service'

export const REG_QUERY_REMINDER_QUEUE = 'reg-query-reminder'

@Processor(REG_QUERY_REMINDER_QUEUE)
export class RegQueryReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: RegQueryReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Regulator query reminder scan complete: ${result.remindersSent} reminder(s), ${result.escalationsSent} overdue escalation(s), across ${result.queriesScanned} scanned`,
    )
  }
}
