import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EquipmentService } from './equipment.service'

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
  const tables = {
    equipment: createTable({ isActive: true, qualificationStatus: 'not_qualified' }),
    facility: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new EquipmentService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('EquipmentService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(
        noCompanyActor,
        { name: 'HPLC-1', equipmentType: 'analytical_instrument' },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates equipment defaulting to not_qualified', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'HPLC-1', equipmentType: 'analytical_instrument' },
      {},
    )
    expect(created.qualificationStatus).toBe('not_qualified')
  })

  it('404s when the facility does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(
        actor,
        { name: 'HPLC-1', equipmentType: 'analytical_instrument', facilityId: 'nope' },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('creates equipment linked to a real facility', async () => {
    const { service, tables } = buildHarness()
    tables.facility.rows.set('facility-1', { id: 'facility-1', companyId: 'company-1' })
    const created = await service.create(
      actor,
      { name: 'HPLC-1', equipmentType: 'analytical_instrument', facilityId: 'facility-1' },
      {},
    )
    expect(created.facilityId).toBe('facility-1')
  })

  it('advances qualificationStatus through update()', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'HPLC-1', equipmentType: 'analytical_instrument' },
      {},
    )
    const updated = await service.update(
      actor,
      created.id,
      { qualificationStatus: 'qualified' },
      {},
    )
    expect(updated.qualificationStatus).toBe('qualified')
  })

  it('404s updating nonexistent equipment', async () => {
    const { service } = buildHarness()
    await expect(
      service.update(actor, 'nonexistent', { qualificationStatus: 'qualified' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('deactivates equipment without deleting it', async () => {
    const { service, tables } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'HPLC-1', equipmentType: 'analytical_instrument' },
      {},
    )
    const deactivated = await service.deactivate(actor, created.id, {})
    expect(deactivated.isActive).toBe(false)
    expect(tables.equipment.rows.get(created.id)).toBeDefined()
  })
})
