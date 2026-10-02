import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegRenewalReminderService } from './reg-renewal-reminder.service'

export const REG_RENEWAL_REMINDER_QUEUE = 'reg-renewal-reminder'

@Processor(REG_RENEWAL_REMINDER_QUEUE)
export class RegRenewalReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: RegRenewalReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Renewal reminder scan complete: ${result.remindersSent} sent across ${result.registrationsScanned} registration(s) within 6 months of expiry`,
    )
  }
}
