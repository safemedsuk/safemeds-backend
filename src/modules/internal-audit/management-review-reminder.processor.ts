import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { ManagementReviewReminderService } from './management-review-reminder.service'

export const MANAGEMENT_REVIEW_REMINDER_QUEUE = 'management-review-reminder'

@Processor(MANAGEMENT_REVIEW_REMINDER_QUEUE)
export class ManagementReviewReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: ManagementReviewReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Management review reminder scan complete: ${result.remindersSent} reminder(s) across ${result.companiesScanned} companies`,
    )
  }
}
