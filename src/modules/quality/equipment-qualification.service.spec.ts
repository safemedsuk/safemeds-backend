import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EquipmentQualificationService } from './equipment-qualification.service'

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
      if (key === 'OR' && Array.isArray(value)) {
        return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
      }
      if (value && typeof value === 'object' && 'lt' in (value as Record<string, unknown>)) {
        const field = row[key] as Date | null
        return field != null && field < (value as { lt: Date }).lt
      }
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
  const equipment = createTable<Row>({ qualificationStatus: 'not_qualified', isActive: true })
  const equipmentQualificationEvent = createTable<Row>()
  const maintenanceRecord = createTable<Row>()

  const tables = { equipment, equipmentQualificationEvent, maintenanceRecord }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const service = new EquipmentQualificationService(rls as never, auditService, tasksService)
  return { service, tables, escalateForRecord }
}

describe('EquipmentQualificationService', () => {
  it('404s against equipment that does not exist', async () => {
    const { service } = buildHarness()
    await expect(service.recordEvent(actor, 'missing', { stage: 'dq' }, {})).rejects.toThrow(
      NotFoundException,
    )
  })

  it('a passed stage event advances the live qualificationStatus summary', async () => {
    const { service, tables } = buildHarness()
    tables.equipment.rows.set('eq-1', { id: 'eq-1', companyId: 'company-1', qualificationStatus: 'not_qualified' })

    await service.recordEvent(actor, 'eq-1', { stage: 'dq', result: 'pass' }, {})
    expect(tables.equipment.rows.get('eq-1')?.qualificationStatus).toBe('dq_complete')

    await service.recordEvent(actor, 'eq-1', { stage: 'iq', result: 'pass' }, {})
    await service.recordEvent(actor, 'eq-1', { stage: 'oq', result: 'pass' }, {})
    await service.recordEvent(actor, 'eq-1', { stage: 'pq', result: 'pass' }, {})
    expect(tables.equipment.rows.get('eq-1')?.qualificationStatus).toBe('qualified')
  })

  it('a failed stage event does NOT advance qualificationStatus', async () => {
    const { service, tables } = buildHarness()
    tables.equipment.rows.set('eq-1', { id: 'eq-1', companyId: 'company-1', qualificationStatus: 'dq_complete' })
    await service.recordEvent(actor, 'eq-1', { stage: 'iq', result: 'fail' }, {})
    expect(tables.equipment.rows.get('eq-1')?.qualificationStatus).toBe('dq_complete')
  })

  it('every DQ/IQ/OQ/PQ step is its own dated event, not a bare flag', async () => {
    const { service, tables } = buildHarness()
    tables.equipment.rows.set('eq-1', { id: 'eq-1', companyId: 'company-1' })
    await service.recordEvent(actor, 'eq-1', { stage: 'dq', result: 'pass', notes: 'all good' }, {})
    await service.recordEvent(actor, 'eq-1', { stage: 'iq', result: 'pass' }, {})
    const events = await service.listEvents(actor, 'eq-1')
    expect(events).toHaveLength(2)
    expect(events[0].stage).toBe('dq')
  })

  it('recordMaintenance() logs a maintenance event and advances the live maintenanceDueAt', async () => {
    const { service, tables } = buildHarness()
    tables.equipment.rows.set('eq-1', { id: 'eq-1', companyId: 'company-1' })
    const next = new Date('2027-06-01')
    await service.recordMaintenance(
      actor,
      'eq-1',
      { maintenanceDate: '2027-01-01', description: 'Routine service', nextDueAt: next.toISOString() },
      {},
    )
    expect((tables.equipment.rows.get('eq-1')?.maintenanceDueAt as Date).toISOString()).toBe(
      next.toISOString(),
    )
    const records = await service.listMaintenance(actor, 'eq-1')
    expect(records).toHaveLength(1)
  })

  it('escalateOverdue() flags overdue equipment via Task, never auto-creating a Deviation', async () => {
    const { service, tables, escalateForRecord } = buildHarness()
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24)
    tables.equipment.rows.set('eq-1', {
      id: 'eq-1',
      companyId: 'company-1',
      name: 'Balance #1',
      isActive: true,
      calibrationDueAt: past,
      maintenanceDueAt: null,
    })
    tables.equipment.rows.set('eq-2', {
      id: 'eq-2',
      companyId: 'company-1',
      name: 'Oven #1',
      isActive: true,
      calibrationDueAt: null,
      maintenanceDueAt: null,
    })

    const result = await service.escalateOverdue()
    expect(result.flagged).toBe(1)
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'equipment',
      'eq-1',
      'overdue',
      expect.stringContaining('calibration overdue'),
      {},
    )
  })
})
