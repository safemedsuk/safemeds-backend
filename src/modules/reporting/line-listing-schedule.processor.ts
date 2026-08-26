import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { LineListingService } from './line-listing.service'

export const LINE_LISTING_SCHEDULE_QUEUE = 'pv-line-listing-schedule'

/** VigiCloud Stage 18 — daily check for a due line listing, same cadence as `SignalDetectionProcessor`/`DuplicateScreeningProcessor`. */
@Processor(LINE_LISTING_SCHEDULE_QUEUE)
export class LineListingScheduleProcessor extends WorkerHost {
  constructor(
    private readonly lineListingService: LineListingService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.lineListingService.scanAllCompanies()
    this.logger.log(
      { result },
      `Line-listing schedule scan complete: ${result.generated} report(s) auto-generated`,
    )
  }
}
