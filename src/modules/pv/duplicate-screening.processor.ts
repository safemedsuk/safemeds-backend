import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { DuplicateDetectionService } from './duplicate-detection.service'

export const DUPLICATE_SCREENING_QUEUE = 'pv-duplicate-screening'

/** VigiCloud Stage 10 — the periodic re-screen, per the EMA guideline's recommended daily cadence. Mirrors `ProductReviewReminderProcessor`'s exact shape. */
@Processor(DUPLICATE_SCREENING_QUEUE)
export class DuplicateScreeningProcessor extends WorkerHost {
  constructor(
    private readonly detectionService: DuplicateDetectionService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.detectionService.scanOpenCases()
    this.logger.log(
      { result },
      `Duplicate-detection periodic scan complete: ${result.reviewsTouched} review(s) touched across ${result.casesScanned} case(s) in ${result.companiesScanned} compan(y/ies)`,
    )
  }
}
