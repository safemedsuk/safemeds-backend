import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall closure check is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface RecallClosureGateResult {
  gate: number
  name: string
  passed: boolean
  reason: string | null
}

export interface RecallClosureCheckResult {
  allClear: boolean
  gates: RecallClosureGateResult[]
}

/** The named `sourceRecordType` a recall-investigation CAPA is filed under — Reconciliation Note 4's own fork resolution. */
export const RECALL_INVESTIGATION_CAPA_SOURCE_TYPE = 'recall_investigation'

/**
 * QualCloud (Phase 13) Stage 10.6 — the real 8-gate closure check,
 * transcribed directly from the Engineering Build Package §5. Every
 * gate is named explicitly when it fails — never a bare "cannot
 * close" — both for the readiness endpoint the frontend polls before
 * even offering the signature step, and for the actual
 * `closure_pending → closed` transition guard in
 * `RecallWorkflowGuards`, which calls this same logic so the two can
 * never drift apart.
 *
 * **Honest, documented interpretations of two gates the spec names but
 * this schema doesn't structurally force a single reading of**:
 * - Gate 3 ("all recovered stock destroyed with a certificate")
 *   is read as: every `RecallDestructionRecord` opened for this
 *   recall's countries has reached `status: 'completed'` (a
 *   certificate attached) — an *open* (not-yet-completed) destruction
 *   record blocks closure, matching the spirit of "destroyed with a
 *   certificate," not the mere fact that a destruction row exists at
 *   all.
 * - Gate 8's "closure submission recorded per country" is read as:
 *   every `RecallCountry` has reached at least `closure_submitted`
 *   status — the real closure e-signature itself is already enforced
 *   by the workflow engine's own signature-gated `closure_pending →
 *   closed` transition (see `workflow.seed-data.ts`), so this gate
 *   only checks the per-country half.
 */
@Injectable()
export class RecallClosureGateService {
  constructor(private readonly rls: RlsService) {}

  async check(actor: AuthenticatedUser, recallId: string): Promise<RecallClosureCheckResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })
      return this.evaluate(tx, companyId, recallId)
    })
  }

  /** The exact same logic, callable from inside an already-open transaction (the workflow guard's own call site). */
  async evaluate(
    tx: Prisma.TransactionClient,
    companyId: string,
    recallId: string,
  ): Promise<RecallClosureCheckResult> {
    const recall = await tx.recall.findUniqueOrThrow({ where: { id: recallId } })
    const countries = await tx.recallCountry.findMany({ where: { companyId, recallId } })
    const countryIds = countries.map((c) => c.id)

    const [
      requirements,
      discrepancies,
      destructionRecords,
      returnRecords,
      effectivenessChecks,
      linkedCapa,
    ] = await Promise.all([
      countryIds.length > 0
        ? tx.recallRequirement.findMany({
            where: { companyId, recallCountryId: { in: countryIds } },
            include: { recallRule: { select: { evidenceTypes: true, blocksClosure: true } } },
          })
        : Promise.resolve([]),
      tx.recallDiscrepancy.findMany({ where: { companyId, recallId } }),
      countryIds.length > 0
        ? tx.recallDestructionRecord.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
        : Promise.resolve([]),
      tx.recallReturnRecord.findMany({ where: { companyId, recallId } }),
      countryIds.length > 0
        ? tx.recallEffectivenessCheck.findMany({ where: { companyId, recallCountryId: { in: countryIds } } })
        : Promise.resolve([]),
      tx.capa.findFirst({
        where: {
          companyId,
          OR: [
            { sourceRecordType: RECALL_INVESTIGATION_CAPA_SOURCE_TYPE, sourceRecordId: recallId },
            ...(recall.rootCauseCapaId ? [{ id: recall.rootCauseCapaId }] : []),
          ],
        },
      }),
    ])

    const gates: RecallClosureGateResult[] = []

    // Gate 1 — every blocksClosure:true requirement complete/waived, in every country.
    const blockingRequirements = requirements.filter((r) => r.recallRule.blocksClosure)
    const openBlockingRequirements = blockingRequirements.filter(
      (r) => r.status !== 'complete' && r.status !== 'waived',
    )
    gates.push({
      gate: 1,
      name: 'All mandatory obligations complete or waived',
      passed: openBlockingRequirements.length === 0,
      reason:
        openBlockingRequirements.length > 0
          ? `${openBlockingRequirements.length} mandatory requirement(s) are still open`
          : null,
    })

    // Gate 2 — no open blocking discrepancy.
    const openBlockingDiscrepancies = discrepancies.filter((d) => d.blocking && d.status !== 'resolved')
    gates.push({
      gate: 2,
      name: 'No unresolved blocking discrepancy',
      passed: openBlockingDiscrepancies.length === 0,
      reason:
        openBlockingDiscrepancies.length > 0
          ? `${openBlockingDiscrepancies.length} blocking discrepancy(ies) have no approved exception`
          : null,
    })

    // Gate 3 — every destruction record completed (certificate attached).
    const incompleteDestruction = destructionRecords.filter((d) => d.status !== 'completed')
    gates.push({
      gate: 3,
      name: 'All recovered stock destroyed with a certificate',
      passed: incompleteDestruction.length === 0,
      reason:
        incompleteDestruction.length > 0
          ? `${incompleteDestruction.length} destruction record(s) have no completion certificate yet`
          : null,
    })

    // Gate 4 — every return record has a verdict.
    const unverifiedReturns = returnRecords.filter((r) => !r.verdict)
    gates.push({
      gate: 4,
      name: 'Every returned unit has a recorded verdict',
      passed: unverifiedReturns.length === 0,
      reason:
        unverifiedReturns.length > 0 ? `${unverifiedReturns.length} return(s) have no verdict recorded yet` : null,
    })

    // Gate 5 — every effectiveness check complete (closed).
    const openEffectivenessChecks = effectivenessChecks.filter((c) => c.status !== 'closed')
    gates.push({
      gate: 5,
      name: 'Every effectiveness check is complete',
      passed: openEffectivenessChecks.length === 0,
      reason:
        openEffectivenessChecks.length > 0
          ? `${openEffectivenessChecks.length} effectiveness check(s) still have open follow-up`
          : null,
    })

    // Gate 6 — a recall-investigation CAPA is linked.
    gates.push({
      gate: 6,
      name: 'A recall-investigation CAPA is linked',
      passed: !!linkedCapa,
      reason: linkedCapa ? null : 'No CAPA has been opened for the root-cause investigation yet',
    })

    // Gate 7 — no mandatory evidence missing (a complete requirement whose rule names evidence types must have at least one).
    const missingEvidence = requirements.filter(
      (r) =>
        r.status === 'complete' &&
        r.recallRule.evidenceTypes.length > 0 &&
        r.evidenceIds.length === 0,
    )
    gates.push({
      gate: 7,
      name: 'No mandatory evidence missing',
      passed: missingEvidence.length === 0,
      reason:
        missingEvidence.length > 0
          ? `${missingEvidence.length} completed requirement(s) are missing their required evidence`
          : null,
    })

    // Gate 8 — closure recorded per country (the e-signature itself is the workflow engine's own gate).
    // A recall with zero countries has nothing to close by definition —
    // deliberately failing rather than vacuously passing (the same
    // "0 ready === 0 mandatory is vacuously green" trap this codebase's
    // own VigiCloud Stage 16.2-A fix already documents and corrects).
    const countriesNotClosureRecorded = countries.filter(
      (c) => c.status !== 'closure_submitted' && c.status !== 'closed_by_regulator',
    )
    gates.push({
      gate: 8,
      name: 'Closure recorded with every country',
      passed: countries.length > 0 && countriesNotClosureRecorded.length === 0,
      reason:
        countries.length === 0
          ? 'No country has been added to this recall yet'
          : countriesNotClosureRecorded.length > 0
            ? `${countriesNotClosureRecorded.length} of ${countries.length} countr${countries.length === 1 ? 'y' : 'ies'} have not reached closure_submitted yet`
            : null,
    })

    return { allClear: gates.every((g) => g.passed), gates }
  }
}
