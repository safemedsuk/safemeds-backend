import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { PROMOTIONAL_MATERIAL_RECORD_TYPE } from './promotional-material-submission.service'

/**
 * RegCloud (Phase 12) Stage 13 — Advertising & Promotion. Registered
 * against the same `WorkflowGuardRegistryService`/`WorkflowStatusSyncRegistryService`
 * extension points every other workflow-backed record type in this
 * codebase uses (`pv_case`, `signal`, `reg_registration`) — no new
 * gating mechanism.
 *
 * Deliberately **no query/response loop** here, unlike `reg_registration`'s
 * own Stage 5 — the sourced build-spec material for this stage itself
 * flags Advertising & Promotion as "least-detailed... Tier 2/3 priority,"
 * and a piece of promotional material being reviewed is a single-artifact
 * approve/reject decision, not a multi-round regulator correspondence.
 * Building a second `RegQuery`-shaped model here would be over-engineering
 * relative to what's actually sourced — extend later if a real discovery
 * answer demands a correction cycle.
 */
@Injectable()
export class PromotionalMaterialWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(
      PROMOTIONAL_MATERIAL_RECORD_TYPE,
      async ({ tx, recordId, toStateKey }) => {
        await tx.promotionalMaterialSubmission.update({
          where: { id: recordId },
          data: { status: toStateKey },
        })
      },
    )

    // Blocked until the material itself has actually been uploaded — a
    // submission with nothing attached has nothing for a reviewer to look at.
    this.guardRegistry.register(
      PROMOTIONAL_MATERIAL_RECORD_TYPE,
      'draft',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'submitted') return { allowed: true }
        const row = await tx.promotionalMaterialSubmission.findUniqueOrThrow({
          where: { id: recordId },
        })
        if (!row.materialDocumentId) {
          return {
            allowed: false,
            reason: 'Attach the promotional material document before submitting it for review.',
          }
        }
        return { allowed: true }
      },
    )
  }
}
