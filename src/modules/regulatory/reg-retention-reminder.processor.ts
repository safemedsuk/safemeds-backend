import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegRetentionReminderService } from './reg-retention-reminder.service'

export const REG_RETENTION_REMINDER_QUEUE = 'reg-retention-reminder'

@Processor(REG_RETENTION_REMINDER_QUEUE)
export class RegRetentionReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: RegRetentionReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Retention reminder scan complete: ${result.remindersSent} sent across ${result.registrationsScanned} active registration(s) scanned`,
    )
  }
}
