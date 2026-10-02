import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { FalsifiedProductReportService } from './falsified-product-report.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
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
    falsifiedProductReport: createTable({ status: 'reported', authorityNotified: false }),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: jest.fn(),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const deviationCreate = jest.fn().mockResolvedValue({ id: 'deviation-1' })
  const deviationService = { create: deviationCreate } as never
  const pvCaseService = { createFromSystemChannel: jest.fn() } as never

  const service = new FalsifiedProductReportService(
    rls as never,
    auditService,
    deviationService,
    pvCaseService,
  )
  return { service, tables, auditLog, deviationCreate }
}

describe('FalsifiedProductReportService', () => {
  it('creates a report in "reported" status', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { source: 'market_surveillance', evidenceDescription: 'Suspicious packaging found' },
      {},
    )
    expect(created.status).toBe('reported')
  })

  it('confirm() opens a real linked Deviation with sourceType monitoring_alert', async () => {
    const { service, deviationCreate } = buildHarness()
    const created = await service.create(
      actor,
      { source: 'distributor', evidenceDescription: 'Mismatched batch number' },
      {},
    )
    const confirmed = await service.confirm(actor, created.id, {}, {})
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.linkedDeviationId).toBe('deviation-1')
    expect(deviationCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ sourceType: 'monitoring_alert' }),
      {},
    )
  })

  it('rejects confirming an already-decided report', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { source: 'regulator', evidenceDescription: 'Confirmed falsified batch' },
      {},
    )
    await service.confirm(actor, created.id, {}, {})
    await expect(service.confirm(actor, created.id, {}, {})).rejects.toThrow(ConflictException)
  })

  it('dismisses a report with a reason', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { source: 'complaint', evidenceDescription: 'Unverified report' },
      {},
    )
    const dismissed = await service.dismiss(actor, created.id, { reason: 'No evidence found' }, {})
    expect(dismissed.status).toBe('dismissed')
    expect(dismissed.dismissedReason).toBe('No evidence found')
  })

  it('close() requires a confirmed report', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { source: 'market_surveillance', evidenceDescription: 'x' },
      {},
    )
    await expect(service.close(actor, created.id, {})).rejects.toThrow(ConflictException)
  })

  it('404s on a nonexistent report', async () => {
    const { service } = buildHarness()
    await expect(service.get(actor, 'missing')).rejects.toThrow(NotFoundException)
  })
})
