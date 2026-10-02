import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EnvironmentalMonitoringService } from './environmental-monitoring.service'

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
  return { rows, create, findFirst, findMany, count }
}

function buildHarness() {
  const facility = createTable<Row>()
  facility.rows.set('facility-1', { id: 'facility-1', companyId: 'company-1' })
  const environmentalMonitoringResult = createTable<Row>()

  const tables = { facility, environmentalMonitoringResult }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const service = new EnvironmentalMonitoringService(rls as never, auditService, tasksService)
  return { service, tables, escalateForRecord }
}

describe('EnvironmentalMonitoringService', () => {
  it('404s against a facility that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.record(
        actor,
        {
          facilityId: 'nope',
          cleanroomGrade: 'A',
          monitoringType: 'viable_air',
          result: '0',
          sampledAt: new Date().toISOString(),
        },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('defaults to the EU GMP Annex 1 grade A viable-air limits and flags no excursion for a clean result', async () => {
    const { service, escalateForRecord } = buildHarness()
    const result = await service.record(
      actor,
      {
        facilityId: 'facility-1',
        cleanroomGrade: 'A',
        monitoringType: 'viable_air',
        result: '0',
        sampledAt: new Date().toISOString(),
      },
      {},
    )
    expect(result.actionLimit).toBe('1')
    expect(result.excursion).toBe(false)
    expect(escalateForRecord).not.toHaveBeenCalled()
  })

  it('flags an action-limit excursion and opens a Task, never a Deviation', async () => {
    const { service, escalateForRecord } = buildHarness()
    const result = await service.record(
      actor,
      {
        facilityId: 'facility-1',
        cleanroomGrade: 'A',
        monitoringType: 'viable_air',
        result: '5',
        sampledAt: new Date().toISOString(),
      },
      {},
    )
    expect(result.excursion).toBe(true)
    expect(result.excursionLevel).toBe('action')
    expect(escalateForRecord).toHaveBeenCalledWith(
      'company-1',
      'environmental_monitoring_result',
      result.id,
      'overdue',
      expect.stringContaining('Action-limit excursion'),
      {},
    )
  })

  it('flags an alert-level (not action-level) excursion without opening a Task', async () => {
    const { service, escalateForRecord } = buildHarness()
    const result = await service.record(
      actor,
      {
        facilityId: 'facility-1',
        cleanroomGrade: 'B',
        monitoringType: 'viable_air',
        result: '7',
        sampledAt: new Date().toISOString(),
      },
      {},
    )
    expect(result.excursion).toBe(true)
    expect(result.excursionLevel).toBe('alert')
    expect(escalateForRecord).not.toHaveBeenCalled()
  })

  it('respects an explicit caller-supplied limit over the Annex 1 default', async () => {
    const { service } = buildHarness()
    const result = await service.record(
      actor,
      {
        facilityId: 'facility-1',
        cleanroomGrade: 'A',
        monitoringType: 'viable_air',
        result: '2',
        actionLimit: '5',
        sampledAt: new Date().toISOString(),
      },
      {},
    )
    expect(result.actionLimit).toBe('5')
    expect(result.excursion).toBe(false)
  })

  it('treats a non-numeric failure-shaped result as an action-level excursion', async () => {
    const { service } = buildHarness()
    const result = await service.record(
      actor,
      {
        facilityId: 'facility-1',
        cleanroomGrade: 'C',
        monitoringType: 'viable_surface',
        result: 'growth_detected',
        sampledAt: new Date().toISOString(),
      },
      {},
    )
    expect(result.excursion).toBe(true)
    expect(result.excursionLevel).toBe('action')
  })

  it('lists results filtered to excursions only', async () => {
    const { service } = buildHarness()
    await service.record(
      actor,
      { facilityId: 'facility-1', cleanroomGrade: 'A', monitoringType: 'viable_air', result: '0', sampledAt: new Date().toISOString() },
      {},
    )
    await service.record(
      actor,
      { facilityId: 'facility-1', cleanroomGrade: 'A', monitoringType: 'viable_air', result: '5', sampledAt: new Date().toISOString() },
      {},
    )
    const page = await service.list(actor, { excursionOnly: true })
    expect(page.data).toHaveLength(1)
    expect(page.data[0].excursion).toBe(true)
  })
})
