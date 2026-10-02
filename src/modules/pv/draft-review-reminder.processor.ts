import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { DraftReviewReminderService } from './draft-review-reminder.service'

export const DRAFT_REVIEW_REMINDER_QUEUE = 'draft-review-reminder'

@Processor(DRAFT_REVIEW_REMINDER_QUEUE)
export class DraftReviewReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: DraftReviewReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Draft-review reminder scan complete: ${result.remindersSent} sent across ${result.draftsScanned} pending drafts`,
    )
  }
}
