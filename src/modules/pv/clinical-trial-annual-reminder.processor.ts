import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { ClinicalTrialAnnualReminderService } from './clinical-trial-annual-reminder.service'

export const CLINICAL_TRIAL_ANNUAL_REMINDER_QUEUE = 'clinical-trial-annual-reminder'

@Processor(CLINICAL_TRIAL_ANNUAL_REMINDER_QUEUE)
export class ClinicalTrialAnnualReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: ClinicalTrialAnnualReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Clinical-trial annual-renewal reminder scan complete: ${result.remindersCreated} created across ${result.trialsScanned} trials`,
    )
  }
}
