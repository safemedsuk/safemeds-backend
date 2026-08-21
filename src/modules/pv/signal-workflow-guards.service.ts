import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { SIGNAL_RECORD_TYPE } from './signal.service'

/**
 * VigiCloud Stage 17 — GVP Module IX's own explicit requirement: "any
 * such decision tree should be documented." Every non-terminal signal
 * state gets a guard requiring a non-empty `note` (the transition's
 * rationale) before the transition is allowed through — reusing the
 * exact `WorkflowGuardRegistryService` extension point Stage 3.7
 * introduced, the same mechanism `PvWorkflowGuards` uses for `pv_case`.
 *
 * Also registers `signal`'s status-sync function against
 * `WorkflowStatusSyncRegistryService` (real-usage bug bash, 16 Aug
 * 2026) — `Signal.status` had the exact same never-written-after-
 * creation bug `Case.status` did, permanently showing "Detected" on
 * the PV Signals list and on every linked-case join, regardless of a
 * signal's real lifecycle stage.
 */
@Injectable()
export class SignalWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(SIGNAL_RECORD_TYPE, async ({ tx, recordId, toStateKey }) => {
      await tx.signal.update({ where: { id: recordId }, data: { status: toStateKey } })
    })

    const nonTerminalStates = [
      'detected',
      'validated',
      'confirmed',
      'analysed_prioritised',
      'assessed',
    ]

    for (const stateKey of nonTerminalStates) {
      this.guardRegistry.register(SIGNAL_RECORD_TYPE, stateKey, ({ note }) => {
        if (note && note.trim().length > 0) {
          return Promise.resolve({ allowed: true })
        }
        return Promise.resolve({
          allowed: false,
          reason:
            'A rationale is required to document every signal lifecycle decision (GVP Module IX).',
        })
      })
    }
  }
}
