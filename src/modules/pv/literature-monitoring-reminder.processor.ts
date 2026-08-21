import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { LiteratureMonitoringReminderService } from './literature-monitoring-reminder.service'

export const LITERATURE_MONITORING_REMINDER_QUEUE = 'literature-monitoring-reminder'

@Processor(LITERATURE_MONITORING_REMINDER_QUEUE)
export class LiteratureMonitoringReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: LiteratureMonitoringReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Literature-monitoring reminder scan complete: ${result.remindersCreated} created across ${result.companiesScanned} companies`,
    )
  }
}
