import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { ReportBuilderService } from './report-builder.service'

export const REPORT_BUILDER_SCHEDULE_QUEUE = 'report-builder-schedule'

/** Real-usage request, 11 Sep 2026 — the "schedule" half of the self-service report builder. Daily check for a saved definition due a fresh export, mirroring `LineListingScheduleProcessor`'s exact shape. */
@Processor(REPORT_BUILDER_SCHEDULE_QUEUE)
export class ReportBuilderScheduleProcessor extends WorkerHost {
  constructor(
    private readonly reportBuilderService: ReportBuilderService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reportBuilderService.scanAndAutoRun()
    this.logger.log(
      { result },
      `Report-builder schedule scan complete: ${result.generated} report(s) auto-exported`,
    )
  }
}
