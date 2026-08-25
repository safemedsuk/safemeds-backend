import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { RECALL_RECORD_TYPE } from './recall.service'

/**
 * RegCloud (Phase 12) Stage 14 — Post-Market & Recall. Registered
 * against the same `WorkflowGuardRegistryService`/`WorkflowStatusSyncRegistryService`
 * extension points every other workflow-backed record type in this
 * codebase uses. The literal linear sequence the build spec's own
 * Stage 14 bullet names (`reported → investigating → notified_to_authority
 * → in_progress → closed`) — no shortcut transitions invented
 * speculatively, since the sourced material only ever describes this one
 * path.
 */
@Injectable()
export class RecallWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(RECALL_RECORD_TYPE, async ({ tx, recordId, toStateKey }) => {
      const data: { status: string; authorityNotifiedAt?: Date } = { status: toStateKey }
      if (toStateKey === 'notified_to_authority') {
        data.authorityNotifiedAt = new Date()
      }
      await tx.recall.update({ where: { id: recordId }, data })
    })

    // Closing out a recall is a real compliance decision — a reason
    // must already be on record (it's required at creation, so this is
    // really a data-integrity backstop, matching the same defensive
    // posture `RegWorkflowGuards`' own `requireApprovalData` guard takes
    // for a registration's approval data).
    this.guardRegistry.register(
      RECALL_RECORD_TYPE,
      'in_progress',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'closed') return { allowed: true }
        const row = await tx.recall.findUniqueOrThrow({ where: { id: recordId } })
        if (!row.reason || row.reason.trim().length === 0) {
          return {
            allowed: false,
            reason: 'A recall reason must be on record before it can be closed.',
          }
        }
        return { allowed: true }
      },
    )
  }
}
