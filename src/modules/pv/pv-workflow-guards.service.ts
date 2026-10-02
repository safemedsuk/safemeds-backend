import { Injectable, OnModuleInit } from '@nestjs/common'

import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from '../workflow/workflow-status-sync-registry.service'
import { PV_CASE_RECORD_TYPE } from './pv-case.service'
import { ValidityGateService } from './validity-gate.service'

/**
 * VigiCloud Stage 3.7 + Stage 4 + Stage 8 + Stage 9 — every `pv_case`
 * workflow guard lives here, registered against
 * `WorkflowGuardRegistryService` rather than hard-coded inside the
 * otherwise domain-agnostic `WorkflowService.transition()`. Guards
 * registered for the same `(recordType, fromStateKey)` pair run in
 * registration order and stop at the first disallow, so e.g. a case
 * missing both a source document and a minimum-criteria field sees the
 * source-document reason first (an arbitrary but stable order — the
 * caller fixes one thing at a time and retries, exactly like any other
 * multi-error form).
 *
 * Also registers `pv_case`'s status-sync function against
 * `WorkflowStatusSyncRegistryService` (real-usage bug bash, 16 Aug
 * 2026) — `Case.status` was never written after creation by any
 * transition, permanently stuck at `intake` on every list/export read
 * (PV Cases list, the AE log CSV export) even though `get()` already
 * read live state. Registered here since this is already the one place
 * `pv_case`'s own workflow behavior is wired up at startup.
 */
@Injectable()
export class PvWorkflowGuards implements OnModuleInit {
  constructor(
    private readonly guardRegistry: WorkflowGuardRegistryService,
    private readonly validityGateService: ValidityGateService,
    private readonly statusSyncRegistry: WorkflowStatusSyncRegistryService,
  ) {}

  onModuleInit(): void {
    this.statusSyncRegistry.register(PV_CASE_RECORD_TYPE, async ({ tx, recordId, toStateKey }) => {
      await tx.case.update({
        where: { id: recordId },
        data: {
          status: toStateKey,
          ...(toStateKey === 'closed_archived' ? { closedAt: new Date() } : {}),
        },
      })
    })

    // Stage 3.7 — mandatory source document.
    this.guardRegistry.register(
      PV_CASE_RECORD_TYPE,
      'intake',
      async ({ tx, companyId, recordId }) => {
        const count = await tx.sourceDocument.count({ where: { companyId, caseId: recordId } })
        return count > 0
          ? { allowed: true }
          : {
              allowed: false,
              reason:
                'This case needs at least one source document attached before it can leave Intake.',
            }
      },
    )

    // Stage 4 — the four minimum criteria (Final doc §D).
    this.guardRegistry.register(PV_CASE_RECORD_TYPE, 'intake', async ({ tx, recordId }) => {
      const result = await this.validityGateService.evaluateInTx(tx, recordId)
      if (result.allowed) return { allowed: true }

      const missing = result.criteria.filter((c) => !c.met).map((c) => c.label)
      return { allowed: false, reason: `This case is missing: ${missing.join(', ')}.` }
    })

    // Stage 8 — every (suspect product × adverse event) pair needs both a
    // WHO-UMC category and a Naranjo score before Medical Review can hand
    // off to Coding. "Both required before the transition unlocks" per
    // the todo doc's own FE bullet — this is that unlock check.
    this.guardRegistry.register(
      PV_CASE_RECORD_TYPE,
      'medical_review',
      async ({ tx, companyId, recordId }) => {
        const pairs = await tx.causalityAssessment.findMany({
          where: { companyId, caseId: recordId },
        })
        const incomplete = pairs.filter((p) => p.whoUmcCategory === null || p.naranjoScore === null)
        if (incomplete.length === 0) return { allowed: true }

        return {
          allowed: false,
          reason: `${incomplete.length} of ${pairs.length} product-reaction pair(s) still need a complete causality assessment (both WHO-UMC and Naranjo) before this case can leave Medical Review.`,
        }
      },
    )

    // Stage 9 — four-eyes: only guards the *approval* path out of
    // Narrative (into Quality Check), not the reject-back-to-Medical-Review
    // path — rejecting your own case for more work isn't a self-certification
    // risk the way approving it forward is.
    this.guardRegistry.register(
      PV_CASE_RECORD_TYPE,
      'narrative',
      async ({ tx, companyId, recordId, toStateKey, actorUserId }) => {
        if (toStateKey !== 'quality_check') return { allowed: true }

        const assessedByThisActor = await tx.causalityAssessment.count({
          where: { companyId, caseId: recordId, assessedBy: actorUserId },
        })
        return assessedByThisActor === 0
          ? { allowed: true }
          : {
              allowed: false,
              reason:
                "The QC reviewer cannot be the same person who performed this case's medical/causality review.",
            }
      },
    )

    // Real-usage request, 22 Sep 2026 — "moving a case back to medical
    // review from narrative should carry a reason besides it, this is
    // highly important." Reuses the exact same requires-a-typed-note
    // mechanism `SignalWorkflowGuards` already established, scoped only
    // to this one outgoing transition (the *approve*-forward path to
    // Quality Check above needs no such reason).
    this.guardRegistry.register(PV_CASE_RECORD_TYPE, 'narrative', ({ toStateKey, note }) => {
      if (toStateKey !== 'medical_review') return Promise.resolve({ allowed: true })
      if (note && note.trim().length > 0) return Promise.resolve({ allowed: true })
      return Promise.resolve({
        allowed: false,
        reason: 'A reason is required when sending a case back to Medical Review from Narrative.',
      })
    })

    // Workflow-map stage 9 — "Cannot close with open obligations": a case
    // can't be locked/archived while it still has an active follow-up
    // cycle or an unresolved possible-duplicate flag against it (on
    // either side of the pairing).
    this.guardRegistry.register(
      PV_CASE_RECORD_TYPE,
      'submitted',
      async ({ tx, companyId, recordId }) => {
        const openFollowUp = await tx.caseFollowUp.findFirst({
          where: {
            companyId,
            caseId: recordId,
            status: { in: ['pending_attempt_1', 'pending_attempt_2'] },
          },
        })
        if (openFollowUp) {
          return {
            allowed: false,
            reason:
              'This case has an open follow-up cycle — resolve or close it before archiving the case.',
          }
        }

        const openDuplicateReview = await tx.duplicateReview.findFirst({
          where: {
            companyId,
            status: 'possible',
            OR: [{ caseId: recordId }, { matchedCaseId: recordId }],
          },
        })
        if (openDuplicateReview) {
          return {
            allowed: false,
            reason:
              'This case has an unresolved possible-duplicate flag — confirm or dismiss it before archiving the case.',
          }
        }

        return { allowed: true }
      },
    )
  }
}
