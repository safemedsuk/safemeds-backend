import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  Batch,
  ChangeControl,
  Complaint,
  Deviation,
  Oos,
  Recall,
  RecallDistributionRecord,
} from '@prisma/client'

/** A real, valid RFC 4122 UUID (any version) — `Batch.id` is a UUID column, so a `parentBatchIds` entry that isn't one (e.g. a supplier's own external lot number) can never match a row and must never even reach the DB as an `{ in: [...] }` filter value, or Postgres throws a cast error instead of just finding nothing. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Batch traceability is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export interface BatchTraceabilityResult {
  batch: Batch
  /** Real upstream batches (this batch's own `parentBatchIds`), resolved where found in this tenant's own register — an id with no matching row (e.g. a supplier's own lot number, never a SafeMeds batch itself) is left as a bare string. */
  upstreamBatches: Batch[]
  unresolvedUpstreamIds: string[]
  /** Every other batch in this tenant's register whose own `parentBatchIds` names this one. */
  downstreamBatches: Batch[]
  deviations: Deviation[]
  changeControls: ChangeControl[]
  complaints: Complaint[]
  oosRecords: Oos[]
  /**
   * `Recall` has no batch-level link in this schema (only `Recall.productId`)
   * — honestly traced by shared product instead of a fabricated batch FK.
   */
  recallsOnSameProduct: Recall[]
  /**
   * QualCloud Stage 10.3 — "the new `RecallDistributionRecord` graph is
   * simply a second data source the same traceability engine walks
   * alongside `parentBatchIds` genealogy," per the build spec's own
   * "reuse, not re-implement" instruction. This is the only place a
   * real distributor/wholesaler chain for this specific batch is
   * visible — `Recall` itself has no batch-level FK.
   */
  recallDistributionRecords: (RecallDistributionRecord & {
    fromOrg: { orgName: string } | null
    toOrg: { orgName: string }
  })[]
}

/**
 * QualCloud (Phase 13) Stage 7 — "trace every input and batch end to
 * end," and the direct data source for the Recall/Crisis dashboard's
 * own "batch-traceability progress" widget. A simple linked-list walk
 * (not a force-directed graph) — a QA user's real question is "what's
 * upstream/downstream of this one batch," not "show me the whole
 * company's batch network."
 */
@Injectable()
export class BatchTraceabilityService {
  constructor(private readonly rls: RlsService) {}

  async trace(actor: AuthenticatedUser, batchId: string): Promise<BatchTraceabilityResult> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id: batchId, companyId } })
      if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      // A `parentBatchIds` entry naming a real UUID might still resolve
      // to nothing (a genealogy note carried over from a batch this
      // tenant no longer has); one that isn't a UUID at all (a
      // supplier's own external lot number) can never resolve, and
      // must never be sent to Postgres as an `{ in: [...] }` filter
      // value at all — that throws a cast error rather than finding
      // nothing.
      const candidateParentIds = batch.parentBatchIds.filter((id) => UUID_PATTERN.test(id))

      const [
        upstreamBatches,
        downstreamBatches,
        deviations,
        changeControls,
        complaints,
        oosRecords,
        recallsOnSameProduct,
        recallDistributionRecords,
      ] = await Promise.all([
        candidateParentIds.length > 0
          ? tx.batch.findMany({ where: { companyId, id: { in: candidateParentIds } } })
          : Promise.resolve([]),
        tx.batch.findMany({ where: { companyId, parentBatchIds: { has: batchId } } }),
        tx.deviation.findMany({ where: { companyId, batchId }, orderBy: { detectedAt: 'desc' } }),
        tx.changeControl.findMany({ where: { companyId, batchId }, orderBy: { createdAt: 'desc' } }),
        tx.complaint.findMany({ where: { companyId, batchId }, orderBy: { createdAt: 'desc' } }),
        tx.oos.findMany({ where: { companyId, batchId }, orderBy: { createdAt: 'desc' } }),
        tx.recall.findMany({ where: { companyId, productId: batch.productId }, orderBy: { createdAt: 'desc' } }),
        tx.recallDistributionRecord.findMany({
          where: { companyId, batchId },
          include: {
            fromOrg: { select: { orgName: true } },
            toOrg: { select: { orgName: true } },
          },
          orderBy: { date: 'desc' },
        }),
      ])

      const resolvedUpstreamIds = new Set(upstreamBatches.map((b) => b.id))
      const unresolvedUpstreamIds = batch.parentBatchIds.filter((id) => !resolvedUpstreamIds.has(id))

      return {
        batch,
        upstreamBatches,
        unresolvedUpstreamIds,
        downstreamBatches,
        deviations,
        changeControls,
        complaints,
        oosRecords,
        recallsOnSameProduct,
        recallDistributionRecords,
      }
    })
  }
}
