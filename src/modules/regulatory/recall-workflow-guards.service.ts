import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  TransitionGuardFn,
  WorkflowGuardRegistryService,
} from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { RECALL_RECORD_TYPE } from './recall.service'
import { RecallClosureGateService } from './recall-closure-gate.service'

/**
 * QualCloud (Phase 13) Stage 10.2 — the real 8-state
 * `draft → under_assessment → approved → notification → execution →
 * reconciliation → closure_pending → closed` lifecycle (superseding
 * the original 5-state `reported → investigating →
 * notified_to_authority → in_progress → closed` sequence). Registered
 * against the same `WorkflowGuardRegistryService`/
 * `WorkflowStatusSyncRegistryService` extension points every other
 * workflow-backed record type in this codebase uses.
 */
@Injectable()
export class RecallWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
    private readonly closureGateService: RecallClosureGateService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(RECALL_RECORD_TYPE, async ({ tx, recordId, toStateKey }) => {
      const data: { status: string; closedAt?: Date } = { status: toStateKey }
      if (toStateKey === 'closed' || toStateKey === 'cancelled') {
        data.closedAt = new Date()
      }
      await tx.recall.update({ where: { id: recordId }, data })
    })

    // The real recall decision — a genuine compliance/business
    // decision, e-signature-gated — needs at minimum a frozen scope
    // (10.2's own "an approved scope version is immutable" rule) and a
    // real hazard evaluation (Stage 0.3's generic `RiskAssessment`
    // reused unchanged, per 10.0's own naming reconciliation) before it
    // can be approved; never a rubber stamp with nothing behind it.
    this.guardRegistry.register(
      RECALL_RECORD_TYPE,
      'under_assessment',
      async ({ tx, recordId, toStateKey }) => {
        if (toStateKey !== 'approved') return { allowed: true }

        const frozenScope = await tx.recallScopeVersion.findFirst({
          where: { recallId: recordId, status: 'frozen' },
        })
        if (!frozenScope) {
          return {
            allowed: false,
            reason: 'Freeze a product/batch scope version before approving this recall.',
          }
        }

        const riskAssessment = await tx.riskAssessment.findFirst({
          where: { sourceRecordType: 'recall', sourceRecordId: recordId },
        })
        if (!riskAssessment) {
          return {
            allowed: false,
            reason: 'Record a hazard/risk evaluation before approving this recall.',
          }
        }

        return { allowed: true }
      },
    )

    // Closing out a recall is a real compliance decision — Stage 10.6's
    // own real 8-gate closure check (`RecallClosureGateService`, the
    // Engineering Build Package's own §5), not a bare data-integrity
    // backstop. Every gate that fails is named explicitly in the
    // returned reason, matching this guard mechanism's own established
    // "never a bare 'cannot close'" discipline.
    this.guardRegistry.register(
      RECALL_RECORD_TYPE,
      'closure_pending',
      async ({ tx, companyId, recordId, toStateKey }) => {
        if (toStateKey !== 'closed') return { allowed: true }
        const result = await this.closureGateService.evaluate(tx, companyId, recordId)
        if (result.allClear) return { allowed: true }
        const failedGates = result.gates.filter((g) => !g.passed)
        return {
          allowed: false,
          reason: failedGates.map((g) => `Gate ${g.gate} (${g.name}): ${g.reason}`).join(' | '),
        }
      },
    )

    // A cancellation must carry a real reason (10.2 — "plus draft/
    // under_assessment → cancelled (reason required)").
    const requireCancellationReason: TransitionGuardFn = ({ toStateKey, note }) => {
      if (toStateKey !== 'cancelled') return Promise.resolve({ allowed: true })
      if (!note || note.trim().length === 0) {
        return Promise.resolve({
          allowed: false,
          reason: 'A reason is required to cancel a recall.',
        })
      }
      return Promise.resolve({ allowed: true })
    }
    this.guardRegistry.register(RECALL_RECORD_TYPE, 'draft', requireCancellationReason)
    this.guardRegistry.register(RECALL_RECORD_TYPE, 'under_assessment', requireCancellationReason)
  }
}
