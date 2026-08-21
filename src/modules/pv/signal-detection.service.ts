import { Injectable } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { WorkflowService } from '../workflow/workflow.service'
import { SIGNAL_RECORD_TYPE, SignalService } from './signal.service'

export interface SignalDetectionResult {
  companiesScanned: number
  signalsCreated: number
  casesLinked: number
}

interface CandidateRow {
  caseId: string
  medicinalProduct: string
  batchNumber: string | null
  organization: string | null
}

interface PatternGroup {
  productIdentifier: string
  batchNumber: string | null
  caseIds: string[]
}

/** A closed set of terminal `pv_case` workflow states — currently just `submitted`, matching every other "is this case still open" check in this codebase (`ClinicalTrialService`'s own open-SAE count uses the identical `status: { not: 'submitted' }` filter). */
const TERMINAL_CASE_STATUSES = ['submitted']

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * VigiCloud Stage 17 — "reviewable pattern flagging only: the same batch
 * or product surfacing across two or more open cases at different
 * facilities" (the Final doc's own stated differentiator from
 * statistical disproportionality methods like PRR/ROR/EBGM, which are
 * Tier 3 and explicitly out of scope for this build). Two independent
 * pattern types, both real triggers per the spec's "batch **or**
 * product" wording: a batch-level pattern (more specific, when a batch
 * number is recorded) and a broader product-level pattern — both are
 * checked, and a case set can legitimately surface in both an
 * appropriately narrow and an appropriately broad signal at once; no
 * suppression logic between them, each is an honestly independent
 * finding.
 *
 * **A real, documented data-model gap**: there is no structured
 * `Case.facilityId` anywhere in this schema — the closest available
 * proxy for "different facilities" is `Reporter.organization` (free
 * text). This detector uses that proxy, normalized (trimmed,
 * lowercased) — a real limitation worth a schema addition if this
 * detector's precision ever needs to improve, not something to silently
 * paper over.
 */
@Injectable()
export class SignalDetectionService {
  constructor(
    private readonly rls: RlsService,
    private readonly signalService: SignalService,
    private readonly workflowService: WorkflowService,
  ) {}

  async scanCompany(companyId: string): Promise<{ signalsCreated: number; casesLinked: number }> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const rows = await tx.suspectProduct.findMany({
        where: {
          companyId,
          case: { duplicateOfCaseId: null, status: { notIn: TERMINAL_CASE_STATUSES } },
        },
        select: {
          caseId: true,
          medicinalProduct: true,
          batchNumber: true,
          case: { select: { reporter: { select: { organization: true } } } },
        },
      })

      const candidates: CandidateRow[] = rows.map((r) => ({
        caseId: r.caseId,
        medicinalProduct: r.medicinalProduct,
        batchNumber: r.batchNumber,
        organization: r.case.reporter?.organization ?? null,
      }))

      const batchGroups = this.groupByPattern(candidates, true)
      const productGroups = this.groupByPattern(candidates, false)

      let signalsCreated = 0
      let casesLinked = 0

      for (const group of [...batchGroups, ...productGroups]) {
        const existing = await tx.signal.findFirst({
          where: {
            companyId,
            productIdentifier: group.productIdentifier,
            batchNumber: group.batchNumber,
            status: { notIn: ['non_validated', 'not_confirmed', 'action_recommended', 'refuted'] },
          },
        })

        let signalId: string
        if (existing) {
          signalId = existing.id
        } else {
          const created = await this.signalService.createInTx(tx, companyId, {
            title: group.batchNumber
              ? `${group.productIdentifier} — batch ${group.batchNumber}`
              : `${group.productIdentifier} — cross-facility pattern`,
            description: group.batchNumber
              ? `Automatically detected: batch "${group.batchNumber}" of "${group.productIdentifier}" appears across ${group.caseIds.length} open case(s) reported by different organizations.`
              : `Automatically detected: "${group.productIdentifier}" appears across ${group.caseIds.length} open case(s) reported by different organizations.`,
            productIdentifier: group.productIdentifier,
            batchNumber: group.batchNumber,
            detectionMethod: 'pattern_flag',
          })
          signalId = created.id
          // System-triggered — no logged-in human actor, matching
          // `PvCaseService.createFromSystemChannel()`'s own precedent for
          // instantiating a workflow with `sub: undefined`.
          await this.instantiateWorkflow(companyId, signalId)
          signalsCreated += 1
        }

        const newlyLinked = await this.signalService.linkCasesInTx(
          tx,
          companyId,
          signalId,
          group.caseIds,
        )
        casesLinked += newlyLinked
      }

      return { signalsCreated, casesLinked }
    })
  }

  async scanAllCompanies(): Promise<SignalDetectionResult> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let signalsCreated = 0
    let casesLinked = 0
    for (const company of companies) {
      const result = await this.scanCompany(company.id)
      signalsCreated += result.signalsCreated
      casesLinked += result.casesLinked
    }

    return { companiesScanned: companies.length, signalsCreated, casesLinked }
  }

  private groupByPattern(candidates: CandidateRow[], byBatch: boolean): PatternGroup[] {
    const buckets = new Map<
      string,
      {
        productIdentifier: string
        batchNumber: string | null
        entries: { caseId: string; org: string | null }[]
      }
    >()

    for (const row of candidates) {
      const product = normalize(row.medicinalProduct)
      if (!product) continue
      if (byBatch && !row.batchNumber) continue

      const batch = byBatch ? normalize(row.batchNumber!) : null
      const key = byBatch ? `${product}::${batch}` : product

      if (!buckets.has(key)) {
        buckets.set(key, {
          productIdentifier: row.medicinalProduct.trim(),
          batchNumber: byBatch ? row.batchNumber!.trim() : null,
          entries: [],
        })
      }
      buckets
        .get(key)!
        .entries.push({
          caseId: row.caseId,
          org: row.organization ? normalize(row.organization) : null,
        })
    }

    const groups: PatternGroup[] = []
    for (const bucket of buckets.values()) {
      const distinctCaseIds = [...new Set(bucket.entries.map((e) => e.caseId))]
      const distinctOrgs = new Set(
        bucket.entries.map((e) => e.org).filter((o): o is string => o !== null),
      )
      if (distinctCaseIds.length >= 2 && distinctOrgs.size >= 2) {
        groups.push({
          productIdentifier: bucket.productIdentifier,
          batchNumber: bucket.batchNumber,
          caseIds: distinctCaseIds,
        })
      }
    }
    return groups
  }

  private async instantiateWorkflow(companyId: string, signalId: string): Promise<void> {
    await this.workflowService.instantiate(
      { companyId, sub: undefined },
      SIGNAL_RECORD_TYPE,
      signalId,
      null,
      {},
    )
  }
}
