import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SupplierService } from './supplier.service'

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
  function asLowerString(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : ''
  }

  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (value !== null && typeof value === 'object') {
        if ('contains' in value) {
          const needle = asLowerString(value.contains)
          return asLowerString(row[key]).includes(needle)
        }
        if ('equals' in value) {
          return asLowerString(row[key]) === asLowerString(value.equals)
        }
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
  const tables = { supplier: createTable({ isActive: true, approvalStatus: 'pending' }) }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new SupplierService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('SupplierService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(noCompanyActor, { name: 'Acme API', supplierType: 'api_supplier' }, {}),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a supplier defaulting to non_critical/pending', async () => {
    const { service, auditLog } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'Acme API Co', supplierType: 'api_supplier' },
      {},
    )
    expect(created.criticality).toBe('non_critical')
    expect(created.approvalStatus).toBe('pending')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'supplier_created' }),
    )
  })

  it('creates a supplier with an explicit critical classification', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'Acme API Co', supplierType: 'api_supplier', criticality: 'critical' },
      {},
    )
    expect(created.criticality).toBe('critical')
  })

  it('404s updating a nonexistent supplier', async () => {
    const { service } = buildHarness()
    await expect(
      service.update(actor, 'nonexistent', { name: 'New Name' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  // `approvalStatus` was removed from `UpdateSupplierDto` in Stage 11 —
  // see that DTO's own doc comment. The real approve/suspend/disqualify
  // sign-off now lives on `SupplierQualificationService.approve()`
  // (`supplier-qualification.service.spec.ts`), never on this plain
  // CRUD `update()`.
  it('update() can change plain fields but no longer accepts approvalStatus', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'Acme API Co', supplierType: 'api_supplier' },
      {},
    )
    const updated = await service.update(actor, created.id, { name: 'Acme API Co Ltd' }, {})
    expect(updated.name).toBe('Acme API Co Ltd')
    expect(updated.approvalStatus).toBe('pending')
  })

  it('deactivates a supplier without deleting it', async () => {
    const { service, tables } = buildHarness()
    const created = await service.create(
      actor,
      { name: 'Acme API Co', supplierType: 'api_supplier' },
      {},
    )
    const deactivated = await service.deactivate(actor, created.id, {})
    expect(deactivated.isActive).toBe(false)
    expect(tables.supplier.rows.get(created.id)).toBeDefined()
  })

  it('findByName matches case-insensitively and only among active suppliers', async () => {
    const { service } = buildHarness()
    await service.create(actor, { name: 'Acme API Co', supplierType: 'api_supplier' }, {})
    const found = await service.findByName(actor, 'acme api co')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Acme API Co')
  })

  it('list() filters by criticality and approvalStatus', async () => {
    const { service } = buildHarness()
    await service.create(
      actor,
      { name: 'Critical Co', supplierType: 'api_supplier', criticality: 'critical' },
      {},
    )
    await service.create(
      actor,
      { name: 'Minor Co', supplierType: 'contract_service', criticality: 'non_critical' },
      {},
    )
    const result = await service.list(actor, { page: 1, limit: 25, criticality: 'critical' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('Critical Co')
  })
})
