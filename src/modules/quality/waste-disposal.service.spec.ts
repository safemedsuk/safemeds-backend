import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { WasteDisposalService } from './waste-disposal.service'

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
    rows.set(data.id, { ...defaults, ...data })
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
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, count, update }
}

function buildHarness() {
  const tables = {
    wasteDisposalRecord: createTable(),
    batch: createTable(),
    document: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const sign = jest.fn().mockResolvedValue({ id: 'sig-1' })
  const signatureService = { sign } as never

  const service = new WasteDisposalService(rls as never, auditService, signatureService)
  return { service, tables, auditLog, sign }
}

describe('WasteDisposalService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(
        noCompanyActor,
        { wasteType: 'expired_stock', quantity: '10', unit: 'kg', disposalMethod: 'incineration', disposedAt: '2026-10-01' },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a waste disposal record', async () => {
    const { service, auditLog } = buildHarness()
    const created = await service.create(
      actor,
      { wasteType: 'expired_stock', quantity: '10', unit: 'kg', disposalMethod: 'incineration', disposedAt: '2026-10-01' },
      {},
    )
    expect(created.wasteType).toBe('expired_stock')
    expect(created.witnessedByUserId).toBeUndefined()
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'waste_disposal_record_created' }),
    )
  })

  it('404s creating against a nonexistent batch', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(
        actor,
        {
          batchId: 'missing-batch',
          wasteType: 'rejected_batch',
          quantity: '5',
          unit: 'kg',
          disposalMethod: 'incineration',
          disposedAt: '2026-10-01',
        },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('records a witness signature and rejects a second one', async () => {
    const { service, sign } = buildHarness()
    const created = await service.create(
      actor,
      { wasteType: 'expired_stock', quantity: '10', unit: 'kg', disposalMethod: 'incineration', disposedAt: '2026-10-01' },
      {},
    )
    const witnessed = await service.recordWitness(
      actor,
      created.id,
      { intentStatement: 'I witnessed this destruction', signatureToken: 'tok-1' },
      {},
    )
    expect(witnessed.witnessedByUserId).toBe(actor.sub)
    expect(sign).toHaveBeenCalledTimes(1)

    await expect(
      service.recordWitness(
        actor,
        created.id,
        { intentStatement: 'again', signatureToken: 'tok-2' },
        {},
      ),
    ).rejects.toThrow(ConflictException)
  })

  it('404s witnessing a nonexistent record', async () => {
    const { service } = buildHarness()
    await expect(
      service.recordWitness(actor, 'missing', { intentStatement: 'x', signatureToken: 'y' }, {}),
    ).rejects.toThrow(NotFoundException)
  })
})
