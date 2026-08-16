import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { AuditReadinessReminderService } from './audit-readiness-reminder.service'

export const AUDIT_READINESS_REMINDER_QUEUE = 'audit-readiness-reminder'

@Processor(AUDIT_READINESS_REMINDER_QUEUE)
export class AuditReadinessReminderProcessor extends WorkerHost {
  constructor(
    private readonly reminderService: AuditReadinessReminderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reminderService.scanAndRemind()
    this.logger.log(
      { result },
      `Audit-readiness reminder scan complete: ${result.remindersCreated} created across ${result.companiesScanned} companies`,
    )
  }
}
