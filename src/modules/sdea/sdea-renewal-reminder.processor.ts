import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { SdeaRenewalReminderService } from './sdea-renewal-reminder.service'

export const SDEA_RENEWAL_REMINDER_QUEUE = 'sdea-renewal-reminder'

@Processor(SDEA_RENEWAL_REMINDER_QUEUE)
export class SdeaRenewalReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: SdeaRenewalReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `SDEA renewal reminder scan complete: ${result.remindersCreated} created across ${result.sdeasScanned} active SDEAs`,
    )
  }
}
