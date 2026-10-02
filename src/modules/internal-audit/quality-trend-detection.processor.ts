import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { QualityTrendDetectionService } from './quality-trend-detection.service'

export const QUALITY_TREND_DETECTION_QUEUE = 'quality-trend-detection'

@Processor(QUALITY_TREND_DETECTION_QUEUE)
export class QualityTrendDetectionProcessor extends WorkerHost {
  constructor(
    private readonly trendDetectionService: QualityTrendDetectionService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.trendDetectionService.scanAndFlag()
    this.logger.log(
      { result },
      `Quality trend detection scan complete: ${result.flagsOpened} opened, ${result.flagsResolved} resolved, across ${result.companiesScanned} companies`,
    )
  }
}
