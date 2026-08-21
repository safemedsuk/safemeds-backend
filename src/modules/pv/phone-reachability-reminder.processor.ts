import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { PhoneReachabilityReminderService } from './phone-reachability-reminder.service'

export const PHONE_REACHABILITY_REMINDER_QUEUE = 'phone-reachability-reminder'

@Processor(PHONE_REACHABILITY_REMINDER_QUEUE)
export class PhoneReachabilityReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: PhoneReachabilityReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Phone-reachability reminder scan complete: ${result.remindersCreated} created across ${result.companiesScanned} companies`,
    )
  }
}
