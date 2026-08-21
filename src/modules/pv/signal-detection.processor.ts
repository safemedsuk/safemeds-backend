import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { SignalDetectionService } from './signal-detection.service'

export const SIGNAL_DETECTION_QUEUE = 'pv-signal-detection'

/** VigiCloud Stage 17 — the periodic re-scan, same daily cadence as `DuplicateScreeningProcessor` (Stage 10) since both are "scan open cases for a pattern" work. */
@Processor(SIGNAL_DETECTION_QUEUE)
export class SignalDetectionProcessor extends WorkerHost {
  constructor(
    private readonly detectionService: SignalDetectionService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.detectionService.scanAllCompanies()
    this.logger.log(
      { result },
      `Signal-detection periodic scan complete: ${result.signalsCreated} signal(s) created, ${result.casesLinked} case link(s) added across ${result.companiesScanned} compan(y/ies)`,
    )
  }
}
