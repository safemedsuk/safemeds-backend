import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'

export const PERIODIC_REPORT_RECORD_TYPE = 'periodic_report'

/**
 * Real-usage request, 11 Sep 2026 — "Periodic and aggregate reports...
 * as proper workflows." Registered against the same
 * `WorkflowStatusSyncRegistryService` extension point every other
 * workflow-backed record type in this codebase uses (`pv_case`,
 * `signal`, `reg_registration`, `promotional_material`, `recall`) — no
 * new gating mechanism. `GeneratedReport.status` (`draft`/`qc_reviewed`/
 * `submitted`) is kept in sync exactly like `Case.status`; `submittedAt`
 * is set the moment the terminal transition fires, matching
 * `ReportsService.submit()`'s own precedent for that field. No guard is
 * registered — unlike `pv_case`'s evidence-before-Submitted gate, a
 * periodic report has no live gateway to condition on (it's dispatched
 * manually, portal or email), so evidence is deliberately an ungated,
 * post-submission action (`PeriodicReportService.attachEvidence()`), not
 * a blocker on this transition.
 */
@Injectable()
export class PeriodicReportWorkflowGuards implements OnModuleInit {
  constructor(private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(
      PERIODIC_REPORT_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        await tx.generatedReport.update({
          where: { id: recordId },
          data: {
            status: toStateKey as 'draft' | 'qc_reviewed' | 'submitted',
            ...(toStateKey === 'submitted' ? { submittedAt: new Date() } : {}),
          },
        })
      },
    )
  }
}
