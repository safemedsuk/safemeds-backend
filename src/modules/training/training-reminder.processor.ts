import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { TrainingReminderService } from './training-reminder.service'

export const TRAINING_REMINDER_QUEUE = 'training-reminder'

@Processor(TRAINING_REMINDER_QUEUE)
export class TrainingReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: TrainingReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Training reminder scan complete: ${result.remindersCreated} created across ${result.recordsScanned} due records`,
    )
  }
}
