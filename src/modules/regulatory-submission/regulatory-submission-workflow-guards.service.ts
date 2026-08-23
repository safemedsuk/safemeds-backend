import { Injectable, OnModuleInit } from '@nestjs/common'

import { PV_CASE_RECORD_TYPE } from '../pv/pv-case.service'
import { WorkflowGuardRegistryService } from '../workflow/workflow-guard-registry.service'

/**
 * VigiCloud Stage 12 — a single guard on `(pv_case, submission_ready)`,
 * blocking the seeded `submission_ready → submitted` transition until
 * the case's latest `RegulatorySubmission` actually has evidence
 * attached (`attachEvidence()`'s own job). Lives in its own small class
 * here, in this module, rather than inside `PvWorkflowGuards` (where
 * every other `pv_case` guard lives) — putting it there would make
 * `PvModule` depend on `RegulatorySubmissionModule`, which already
 * depends on `PvModule` itself (for `PV_CASE_RECORD_TYPE` and, via
 * `PvCaseController`, `RegulatorySubmissionService`) — a real circular-
 * dependency risk this split avoids, not an arbitrary inconsistency.
 *
 * **Real, previously-shipped bug found and fixed while building Stage
 * 14, unrelated to that stage's own scope**: this guard originally
 * required a `RegulatorySubmission` row unconditionally, for every
 * `pv_case` reaching `submission_ready` — but `RegulatorySubmissionService.generate()`
 * only ever creates one for a report type whose active `SubmissionFormat`
 * uses the `vigiflow` channel (see that service's own `generate()`).
 * AEFI (routed to NVIP/DHIS2, per Stage 12's own seeded
 * `KENYA_SUBMISSION_FORMATS`) has *never* been able to generate a
 * `RegulatorySubmission` — meaning every AEFI case has been permanently
 * stuck at Submission Ready, unable to ever reach the terminal
 * `submitted` state, since Stage 12 shipped. Adding Stage 14's
 * `clinical_trial_sae` report type (no `SubmissionFormat` seeded for it
 * at all — it reports to an Ethics Committee/trial portal, never PPB)
 * would have hit the exact same dead end. Fixed by checking whether the
 * report type even has an active `vigiflow` `SubmissionFormat` before
 * requiring evidence at all — if it doesn't, E2B/VigiFlow simply isn't
 * this report type's reporting mechanism, so this guard has nothing to
 * check and gets out of the way (the transition's own normal role
 * requirement still applies, unaffected).
 */
@Injectable()
export class RegulatorySubmissionWorkflowGuards implements OnModuleInit {
  constructor(private readonly guardRegistry: WorkflowGuardRegistryService) {}

  onModuleInit(): void {
    this.guardRegistry.register(
      PV_CASE_RECORD_TYPE,
      'submission_ready',
      async ({ tx, companyId, recordId, toStateKey }) => {
        if (toStateKey !== 'submitted') return { allowed: true }

        const pvCase = await tx.case.findFirst({
          where: { id: recordId, companyId },
          select: { reportTypeId: true },
        })
        if (!pvCase) return { allowed: true }

        const vigiflowFormat = await tx.submissionFormat.findFirst({
          where: { reportTypeId: pvCase.reportTypeId, channel: 'vigiflow', status: 'active' },
        })
        if (!vigiflowFormat) {
          // This report type doesn't submit via E2B/VigiFlow at all (e.g.
          // AEFI routes through DHIS2, a clinical-trial SAE reports to an
          // Ethics Committee/trial portal) — nothing for this guard to check.
          return { allowed: true }
        }

        const latest = await tx.regulatorySubmission.findFirst({
          where: { companyId, caseId: recordId },
          orderBy: { submissionNumber: 'desc' },
        })

        if (!latest) {
          return {
            allowed: false,
            reason:
              'No E2B submission has been generated for this case yet — generate one before marking it Submitted.',
          }
        }
        if (!latest.evidenceDocumentId) {
          return {
            allowed: false,
            reason:
              "This case's generated submission has no upload confirmation/acknowledgement evidence attached yet.",
          }
        }
        return { allowed: true }
      },
    )
  }
}
