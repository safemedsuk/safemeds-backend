import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RETENTION_POLICY_DEFAULT_YEARS, RetentionPolicyService } from './retention-policy.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
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
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
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
  const tables = { retentionPolicy: createTable() }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new RetentionPolicyService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('RetentionPolicyService', () => {
  it('getDefault() returns the coded domain defaults', () => {
    const { service } = buildHarness()
    expect(service.getDefault('controlled_document')).toBe(10)
    expect(service.getDefault('deviation')).toBe(5)
  })

  it('getDefault() honestly returns null for training_record (no flat year-count default exists)', () => {
    const { service } = buildHarness()
    expect(service.getDefault('training_record')).toBeNull()
    expect(RETENTION_POLICY_DEFAULT_YEARS['training_record']).toBeUndefined()
  })

  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.upsert(noCompanyActor, { recordType: 'deviation', retentionYears: 5 }, {}),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a new override row when none exists', async () => {
    const { service, auditLog } = buildHarness()
    const saved = await service.upsert(actor, { recordType: 'deviation', retentionYears: 7 }, {})
    expect(saved.retentionYears).toBe(7)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'retention_policy_created' }),
    )
  })

  it('updates an existing row in place on the same natural key, not a duplicate', async () => {
    const { service, tables, auditLog } = buildHarness()
    await service.upsert(actor, { recordType: 'deviation', retentionYears: 5 }, {})
    const updated = await service.upsert(actor, { recordType: 'deviation', retentionYears: 8 }, {})
    expect(updated.retentionYears).toBe(8)
    expect(tables.retentionPolicy.rows.size).toBe(1)
    expect(auditLog).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'retention_policy_updated' }),
    )
  })
})
