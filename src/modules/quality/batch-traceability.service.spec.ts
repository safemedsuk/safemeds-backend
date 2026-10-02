import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BatchTraceabilityService } from './batch-traceability.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
  platformRole: null,
  tokenVersion: 1,
}
const noCompanyActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: null,
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

// `Batch.id` is a real UUID column — `BatchTraceabilityService.trace()`
// only ever sends UUID-shaped `parentBatchIds` entries to the DB as an
// `{ in: [...] }` filter (a non-UUID entry, like a supplier's own
// external lot number, is left unresolved without ever being queried —
// see that service's own doc comment). These fixture ids are real UUIDs
// so this distinction is actually exercised, not accidentally masked.
const BATCH_FINAL_ID = '11111111-1111-4111-8111-111111111111'
const BATCH_API_ID = '22222222-2222-4222-8222-222222222222'
const BATCH_DOWNSTREAM_ID = '33333333-3333-4333-8333-333333333333'

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(rowsInit: T[] = []) {
  const rows = new Map<string, T>(rowsInit.map((r) => [r.id, r]))
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected === undefined) return true
    if (expected !== null && typeof expected === 'object') {
      const ops = expected as Record<string, unknown>
      if ('in' in ops) return Array.isArray(ops.in) && (ops.in as unknown[]).includes(actual)
      if ('has' in ops) return Array.isArray(actual) && (actual as unknown[]).includes(ops.has)
    }
    return actual === expected
  }
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
  }
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  return { rows, findFirst, findMany }
}

function buildHarness() {
  const tables = {
    batch: createTable([
      { id: BATCH_FINAL_ID, companyId: 'company-1', productId: 'product-1', parentBatchIds: [BATCH_API_ID, 'lot-external-1'] },
      { id: BATCH_API_ID, companyId: 'company-1', productId: 'product-2', parentBatchIds: [] },
      { id: BATCH_DOWNSTREAM_ID, companyId: 'company-1', productId: 'product-1', parentBatchIds: [BATCH_FINAL_ID] },
    ]),
    deviation: createTable([{ id: 'dev-1', companyId: 'company-1', batchId: BATCH_FINAL_ID }]),
    changeControl: createTable([]),
    complaint: createTable([{ id: 'cmp-1', companyId: 'company-1', batchId: BATCH_FINAL_ID }]),
    oos: createTable([{ id: 'oos-1', companyId: 'company-1', batchId: BATCH_FINAL_ID }]),
    recall: createTable([{ id: 'recall-1', companyId: 'company-1', productId: 'product-1' }]),
    recallDistributionRecord: createTable([
      {
        id: 'dist-1',
        companyId: 'company-1',
        batchId: BATCH_FINAL_ID,
        recallId: 'recall-1',
        toOrgId: 'stakeholder-1',
        toOrg: { orgName: 'Nairobi Wholesale Ltd' },
        fromOrgId: null,
        fromOrg: null,
        qtyUnits: 500,
      },
    ]),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const service = new BatchTraceabilityService(rls as never)
  return { service, tables }
}

describe('BatchTraceabilityService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(service.trace(noCompanyActor, BATCH_FINAL_ID)).rejects.toThrow(ForbiddenException)
  })

  it('404s for a nonexistent batch', async () => {
    const { service } = buildHarness()
    await expect(service.trace(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
  })

  it('walks upstream batches, leaving a non-catalog lot id unresolved', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_FINAL_ID)
    expect(result.upstreamBatches.map((b) => b.id)).toEqual([BATCH_API_ID])
    expect(result.unresolvedUpstreamIds).toEqual(['lot-external-1'])
  })

  it('walks downstream batches (whose own parentBatchIds name this one)', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_FINAL_ID)
    expect(result.downstreamBatches.map((b) => b.id)).toEqual([BATCH_DOWNSTREAM_ID])
  })

  it('gathers every linked quality event for this batch', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_FINAL_ID)
    expect(result.deviations.map((d) => d.id)).toEqual(['dev-1'])
    expect(result.complaints.map((c) => c.id)).toEqual(['cmp-1'])
    expect(result.oosRecords.map((o) => o.id)).toEqual(['oos-1'])
  })

  it('traces recalls by shared product, honestly (Recall has no batch-level FK)', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_FINAL_ID)
    expect(result.recallsOnSameProduct.map((r) => r.id)).toEqual(['recall-1'])
  })

  it('never surfaces a recall for an unrelated product', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_API_ID)
    expect(result.recallsOnSameProduct).toEqual([])
  })

  it('walks the recall distribution-record graph for this specific batch (Stage 10.3 reuse)', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_FINAL_ID)
    expect(result.recallDistributionRecords.map((r) => r.id)).toEqual(['dist-1'])
    expect(result.recallDistributionRecords[0].toOrg.orgName).toBe('Nairobi Wholesale Ltd')
  })

  it('never surfaces a distribution record for an unrelated batch', async () => {
    const { service } = buildHarness()
    const result = await service.trace(actor, BATCH_API_ID)
    expect(result.recallDistributionRecords).toEqual([])
  })
})
