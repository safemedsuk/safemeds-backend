import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { CapaService } from './capa.service'

export const CAPA_OVERDUE_QUEUE = 'capa-overdue-scan'

/**
 * QualCloud (Phase 13) Stage 3 — the daily overdue-CAPA scan. Mirrors
 * every other daily overdue-scan processor in this codebase (RegCloud's
 * fee/obligation/licensing scans, `WorkflowModule`'s own deadline scan)
 * rather than inventing a new job shape.
 */
@Processor(CAPA_OVERDUE_QUEUE)
export class CapaOverdueProcessor extends WorkerHost {
  constructor(
    private readonly capaService: CapaService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.capaService.escalateOverdue()
    this.logger.log(
      { result },
      `CAPA overdue scan complete: ${result.capasEscalated} CAPA(s) escalated across ${result.companiesScanned} compan(y/ies)`,
    )
  }
}
