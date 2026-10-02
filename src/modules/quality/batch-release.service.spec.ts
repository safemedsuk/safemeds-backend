import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BatchReleaseService } from './batch-release.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, createdAt: new Date(), ...data })
    return Promise.resolve(rows.get(data.id))
  })
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
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    batch: createTable({ qualityStatus: 'quarantine' }),
    batchRecordReview: createTable(),
    batchReleaseDecision: createTable(),
    deviation: createTable(),
    oos: createTable(),
    complaint: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const sign = jest.fn().mockResolvedValue({ id: 'sig-1' })
  const signatureService = { sign } as never

  const service = new BatchReleaseService(rls as never, auditService, signatureService)
  return { service, tables, auditLog, sign }
}

describe('BatchReleaseService', () => {
  it('404s on a nonexistent batch', async () => {
    const { service } = buildHarness()
    await expect(service.getReadiness(actor, 'missing')).rejects.toThrow(NotFoundException)
  })

  it('readiness fails without a reviewed-and-released BatchRecordReview', async () => {
    const { service, tables } = buildHarness()
    await tables.batch.create({ data: { id: 'batch-1', companyId: 'company-1' } })
    const readiness = await service.getReadiness(actor, 'batch-1')
    expect(readiness.allPassed).toBe(false)
    expect(readiness.items.find((i) => i.key === 'batch_record_review')!.passed).toBe(false)
  })

  it('release() is blocked without a reviewed-and-released BatchRecordReview', async () => {
    const { service, tables } = buildHarness()
    await tables.batch.create({ data: { id: 'batch-1', companyId: 'company-1' } })
    await expect(
      service.release(
        actor,
        'batch-1',
        { decision: 'released', riskAcceptances: [], intentStatement: 'I release this batch', signatureToken: 'tok' },
        {},
      ),
    ).rejects.toThrow(ConflictException)
  })

  it('release() is blocked by an open deviation unless risk-accepted, then succeeds with risk acceptance', async () => {
    const { service, tables, sign } = buildHarness()
    await tables.batch.create({ data: { id: 'batch-1', companyId: 'company-1' } })
    await tables.batchRecordReview.create({
      data: { id: 'brr-1', companyId: 'company-1', batchId: 'batch-1', disposition: 'released' },
    })
    await tables.deviation.create({
      data: { id: 'dev-1', companyId: 'company-1', batchId: 'batch-1', deviationNumber: 'DEV-2026-00001', closedAt: null },
    })

    await expect(
      service.release(
        actor,
        'batch-1',
        { decision: 'released', riskAcceptances: [], intentStatement: 'release', signatureToken: 'tok' },
        {},
      ),
    ).rejects.toThrow(ConflictException)

    const decision = await service.release(
      actor,
      'batch-1',
      {
        decision: 'released',
        riskAcceptances: [{ recordType: 'quality_deviation', recordId: 'dev-1', reason: 'Minor, unrelated to this batch' }],
        intentStatement: 'release',
        signatureToken: 'tok',
      },
      {},
    )
    expect(decision.decision).toBe('released')
    expect(sign).toHaveBeenCalledTimes(1)
    expect(tables.batch.rows.get('batch-1')!.qualityStatus).toBe('released')
  })

  it('rejects a second release decision for the same batch', async () => {
    const { service, tables } = buildHarness()
    await tables.batch.create({ data: { id: 'batch-1', companyId: 'company-1' } })
    await tables.batchRecordReview.create({
      data: { id: 'brr-1', companyId: 'company-1', batchId: 'batch-1', disposition: 'released' },
    })
    await service.release(
      actor,
      'batch-1',
      { decision: 'released', riskAcceptances: [], intentStatement: 'release', signatureToken: 'tok' },
      {},
    )
    await expect(
      service.release(
        actor,
        'batch-1',
        { decision: 'released', riskAcceptances: [], intentStatement: 'release again', signatureToken: 'tok' },
        {},
      ),
    ).rejects.toThrow(ConflictException)
  })
})
