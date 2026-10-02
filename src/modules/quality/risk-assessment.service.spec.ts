import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RiskAssessmentService } from './risk-assessment.service'

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
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, count, update }
}

function buildHarness() {
  const tables = { riskAssessment: createTable() }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new RiskAssessmentService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('RiskAssessmentService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(noCompanyActor, { title: 'x', severity: 3, probability: 3 }, {}),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a risk assessment against an arbitrary quality-event source, with a computed score', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      {
        sourceRecordType: 'deviation',
        sourceRecordId: 'deviation-1',
        title: 'Temperature excursion',
        severity: 4,
        probability: 4,
        detectability: 3,
      },
      {},
    )
    expect(created.score).toBe(48)
    expect(created.riskLevel).toBe('medium')
    expect(created.riskMethod).toBe('risk_matrix_2x2')
  })

  it('404s updating a nonexistent risk assessment', async () => {
    const { service } = buildHarness()
    await expect(service.update(actor, 'nonexistent', { severity: 5 }, {})).rejects.toThrow(
      NotFoundException,
    )
  })

  it('recomputes score/riskLevel when severity/probability change on update()', async () => {
    const { service } = buildHarness()
    const created = await service.create(actor, { title: 'x', severity: 1, probability: 1 }, {})
    expect(created.riskLevel).toBe('low')
    const updated = await service.update(actor, created.id, { severity: 5, probability: 5 }, {})
    expect(updated.score).toBe(25)
    expect(updated.riskLevel).toBe('high')
  })

  it('preserves detectability across an update that only changes severity', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { title: 'x', severity: 2, probability: 2, detectability: 2 },
      {},
    )
    const updated = await service.update(actor, created.id, { severity: 4 }, {})
    expect(updated.detectability).toBe(2)
    expect(updated.score).toBe(16) // 4 * 2 * 2
  })

  it('list() filters by sourceRecordType/sourceRecordId and riskLevel', async () => {
    const { service } = buildHarness()
    await service.create(
      actor,
      {
        sourceRecordType: 'deviation',
        sourceRecordId: 'd-1',
        title: 'a',
        severity: 5,
        probability: 5,
      },
      {},
    )
    await service.create(
      actor,
      {
        sourceRecordType: 'change_control',
        sourceRecordId: 'c-1',
        title: 'b',
        severity: 1,
        probability: 1,
      },
      {},
    )
    const result = await service.list(actor, { page: 1, limit: 25, sourceRecordType: 'deviation' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0].title).toBe('a')
  })
})
