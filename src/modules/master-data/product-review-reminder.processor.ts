import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { ProductReviewReminderService } from './product-review-reminder.service'

export const PRODUCT_REVIEW_REMINDER_QUEUE = 'product-review-reminder'

@Processor(PRODUCT_REVIEW_REMINDER_QUEUE)
export class ProductReviewReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: ProductReviewReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Product-list-review reminder scan complete: ${result.remindersCreated} created across ${result.companiesScanned} companies`,
    )
  }
}
