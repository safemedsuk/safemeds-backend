import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { EquipmentQualificationService } from './equipment-qualification.service'
import { SupplierQualificationService } from './supplier-qualification.service'

export const SUPPLIER_REQUALIFICATION_QUEUE = 'supplier-requalification-scan'
export const CALIBRATION_MAINTENANCE_QUEUE = 'calibration-maintenance-scan'

/** QualCloud (Phase 13) Stage 11 — the daily re-qualification-due scan, mirroring every other overdue-scan processor in this codebase (`CapaOverdueProcessor` et al.). */
@Processor(SUPPLIER_REQUALIFICATION_QUEUE)
export class SupplierRequalificationProcessor extends WorkerHost {
  constructor(
    private readonly supplierQualificationService: SupplierQualificationService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.supplierQualificationService.escalateDueRequalifications()
    this.logger.log(
      { result },
      `Supplier re-qualification scan complete: ${result.suppliersEscalated} supplier(s) flagged`,
    )
  }
}

/** QualCloud (Phase 13) Stage 14 — the daily calibration/maintenance-due scan, flagging overdue equipment as a real deviation candidate (see `EquipmentQualificationService.escalateOverdue()`'s own doc comment for why this offers rather than auto-creates). */
@Processor(CALIBRATION_MAINTENANCE_QUEUE)
export class CalibrationMaintenanceScanProcessor extends WorkerHost {
  constructor(
    private readonly equipmentQualificationService: EquipmentQualificationService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.equipmentQualificationService.escalateOverdue()
    this.logger.log({ result }, `Calibration/maintenance scan complete: ${result.flagged} equipment item(s) flagged`)
  }
}
