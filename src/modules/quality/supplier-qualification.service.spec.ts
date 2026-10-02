import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SupplierQualificationService } from './supplier-qualification.service'

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
    .mockImplementation(({ where, include }: { where: Record<string, unknown>; include?: unknown }) =>
      Promise.resolve(
        [...rows.values()].find((r) => matches(r, where))
          ? { ...[...rows.values()].find((r) => matches(r, where)), ...(include ? {} : {}) }
          : null,
      ),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.get(where.id) ?? null),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = rows.get(where.id)!
      const merged: Record<string, unknown> = { ...existing }
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'push' in (value as Record<string, unknown>)) {
          const existingArr = (merged[key] as unknown[]) ?? []
          merged[key] = [...existingArr, (value as { push: unknown }).push]
        } else {
          merged[key] = value
        }
      }
      rows.set(where.id, merged as T)
      return Promise.resolve(merged)
    })
  return { rows, create, findFirst, findMany, findUnique, update }
}

function buildHarness() {
  const supplier = createTable<Row>({
    performanceFlags: [],
    approvalStatus: 'pending',
    criticality: 'critical',
  })
  const supplierQuestionnaire = createTable<Row>()
  const certificateOfAnalysis = createTable<Row>()
  const specification = createTable<Row>()
  const company = createTable<Row>()

  const tables = { supplier, supplierQuestionnaire, certificateOfAnalysis, specification, company }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const internalAuditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' })
  const internalAuditService = { create: internalAuditCreate } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never

  const service = new SupplierQualificationService(
    rls as never,
    auditService,
    internalAuditService,
    tasksService,
  )
  return { service, tables, auditLog, internalAuditCreate, escalateForRecord }
}

describe('SupplierQualificationService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.assess(noCompanyActor, 'supplier-1', { title: 'x', criteria: [] }, {}),
    ).rejects.toThrow(ForbiddenException)
  })

  it('404s assess() against a supplier that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.assess(actor, 'missing', { title: 'x', criteria: [{ question: 'q', weight: 1, score: 1 }] }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('computes a normalized 0-100 overallScore from weighted criteria', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1' })
    const result = await service.assess(
      actor,
      's1',
      {
        title: 'Annual Review',
        criteria: [
          { question: 'Quality system', weight: 2, score: 10 },
          { question: 'Delivery performance', weight: 1, score: 5 },
        ],
      },
      {},
    )
    // (2*10 + 1*5) / (3*10) * 100 = 83.33 -> 83
    expect(result.overallScore).toBe(83)
  })

  it('schedules a supplier-scope internal audit via InternalAuditService, not a parallel mechanism', async () => {
    const { service, tables, internalAuditCreate } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1', name: 'Acme API Co' })
    await service.scheduleAudit(actor, 's1', { scheduledDate: '2027-01-01' }, {})
    expect(internalAuditCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ auditScope: 'supplier', supplierId: 's1' }),
      {},
    )
  })

  it('approve() computes a 12-month-out requalification date for a critical supplier by default', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', {
      id: 's1',
      companyId: 'company-1',
      criticality: 'critical',
      approvalStatus: 'pending',
    })
    tables.company.rows.set('company-1', { id: 'company-1' })

    const updated = await service.approve(actor, 's1', { approvalStatus: 'approved' }, {})
    expect(updated.approvalStatus).toBe('approved')
    const due = updated.nextRequalificationDueAt as Date
    const expected = new Date()
    expected.setUTCMonth(expected.getUTCMonth() + 12)
    expect(due.getUTCFullYear()).toBe(expected.getUTCFullYear())
    expect(due.getUTCMonth()).toBe(expected.getUTCMonth())
  })

  it('approve() honors a company-level requalification override', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', {
      id: 's1',
      companyId: 'company-1',
      criticality: 'non_critical',
      approvalStatus: 'pending',
    })
    tables.company.rows.set('company-1', {
      id: 'company-1',
      supplierNonCriticalRequalificationMonths: 6,
    })

    const updated = await service.approve(actor, 's1', { approvalStatus: 'approved' }, {})
    const due = updated.nextRequalificationDueAt as Date
    const expected = new Date()
    expected.setUTCMonth(expected.getUTCMonth() + 6)
    expect(due.getUTCMonth()).toBe(expected.getUTCMonth())
  })

  it('monitor() appends a timestamped flag without losing prior flags', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1', performanceFlags: [] })
    await service.monitor(actor, 's1', { flag: 'late delivery' }, {})
    const updated = await service.monitor(actor, 's1', { flag: 'CoA discrepancy' }, {})
    expect((updated.performanceFlags).length).toBe(2)
    expect((updated.performanceFlags)[1]).toContain('CoA discrepancy')
  })

  it('createCoa() computes pass/fail against numeric spec limits and quarantines on any failure', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1' })
    tables.specification.rows.set('spec-1', {
      id: 'spec-1',
      companyId: 'company-1',
      specificationType: 'raw_material',
      parameters: [
        { id: 'p1', lowerLimit: '95', upperLimit: '105' },
        { id: 'p2', lowerLimit: null, upperLimit: null },
      ],
    })

    const coa = await service.createCoa(
      actor,
      {
        supplierId: 's1',
        materialSpecificationId: 'spec-1',
        batchOrLotNumber: 'LOT-001',
        results: [
          { parameterId: 'p1', parameterName: 'Assay', resultValue: '110' },
          { parameterId: 'p2', parameterName: 'Appearance', resultValue: 'ok' },
        ],
      },
      {},
    )
    expect(coa.disposition).toBe('quarantined')
    const results = coa.results as { parameterId: string; pass: boolean }[]
    expect(results.find((r) => r.parameterId === 'p1')?.pass).toBe(false)
  })

  it('createCoa() accepts when every result passes', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1' })
    tables.specification.rows.set('spec-1', {
      id: 'spec-1',
      companyId: 'company-1',
      specificationType: 'api',
      parameters: [{ id: 'p1', lowerLimit: '95', upperLimit: '105' }],
    })

    const coa = await service.createCoa(
      actor,
      {
        supplierId: 's1',
        materialSpecificationId: 'spec-1',
        batchOrLotNumber: 'LOT-002',
        results: [{ parameterId: 'p1', parameterName: 'Assay', resultValue: '100' }],
      },
      {},
    )
    expect(coa.disposition).toBe('accepted')
  })

  it('rejects a CoA against a finished_product specification', async () => {
    const { service, tables } = buildHarness()
    tables.supplier.rows.set('s1', { id: 's1', companyId: 'company-1' })
    tables.specification.rows.set('spec-1', {
      id: 'spec-1',
      companyId: 'company-1',
      specificationType: 'finished_product',
      parameters: [],
    })

    await expect(
      service.createCoa(
        actor,
        { supplierId: 's1', materialSpecificationId: 'spec-1', batchOrLotNumber: 'L1', results: [] },
        {},
      ),
    ).rejects.toThrow()
  })
})
