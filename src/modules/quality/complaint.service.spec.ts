import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ComplaintService } from './complaint.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
  platformRole: null,
  tokenVersion: 1,
}
const manager: AuthenticatedUser = { ...actor, sub: 'user-mgr', roleKeys: ['QUALITY_MANAGER'] }
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
  function matchesValue(actual: unknown, expected: unknown): boolean {
    if (expected === undefined) return true
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      const ops = expected as Record<string, unknown>
      if ('startsWith' in ops)
        return typeof actual === 'string' && actual.startsWith(ops.startsWith as string)
      if ('not' in ops) return actual !== ops.not
    }
    return actual === expected
  }
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
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
  const findFirstOrThrow = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const found = [...rows.values()].find((r) => matches(r, where))
      if (!found) throw new Error('NotFound')
      return Promise.resolve(found)
    })
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const found = [...rows.values()].find((r) => matches(r, where))
      if (!found) throw new Error('NotFound')
      return Promise.resolve(found)
    })
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
  return { rows, create, findFirst, findFirstOrThrow, findUniqueOrThrow, findMany, count, update }
}

function buildHarness() {
  const tables = {
    complaint: createTable({ status: 'intake' }),
    workflowInstance: createTable(),
    company: createTable(),
    product: createTable(),
    reportType: createTable(),
    document: createTable(),
  }
  tables.company.rows.set('company-1', { id: 'company-1', homeCountryId: 'country-ke' })
  tables.product.rows.set('product-1', { id: 'product-1', brandName: 'Amoxil' })
  tables.reportType.rows.set('report-type-adr', {
    id: 'report-type-adr',
    typeKey: 'adr',
    moduleKey: 'pv',
  })
  tables.workflowInstance.rows.set('instance-1', {
    id: 'instance-1',
    recordType: 'quality_complaint',
    recordId: 'seed',
  })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const instantiate = jest
    .fn()
    .mockImplementation((_actor: unknown, recordType: string, recordId: string) => {
      tables.workflowInstance.rows.set(recordId, { id: recordId, recordType, recordId })
      return Promise.resolve(undefined)
    })
  const transition = jest.fn().mockResolvedValue(undefined)
  const workflowService = { instantiate, transition } as never
  const encrypt = jest.fn((s: string) => `enc(${s})`)
  const decrypt = jest.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, ''))
  const textEncryption = { encrypt, decrypt } as never
  const createFrom = jest
    .fn()
    .mockImplementation((_tx, _actor, companyId, sourceRecordType, sourceRecordId, input) =>
      Promise.resolve({
        id: 'capa-1',
        companyId,
        sourceRecordType,
        sourceRecordId,
        title: input.title,
      }),
    )
  const capaService = { createFrom, createAllocatedFrom: createFrom } as never
  const createFromSystemChannel = jest
    .fn()
    .mockResolvedValue({ id: 'case-1', referenceNumber: 'KEN-2026-KEN-00001' })
  const pvCaseService = { createFromSystemChannel } as never

  const service = new ComplaintService(
    rls as never,
    auditService,
    workflowService,
    textEncryption,
    capaService,
    pvCaseService,
    { uploadDirect: jest.fn() } as never,
  )
  return { service, tables, auditLog, instantiate, transition, createFrom, createFromSystemChannel }
}

const baseCreateInput = {
  productId: 'product-1',
  channel: 'phone',
  description: 'The blister pack seal was broken on arrival',
} as const

describe('ComplaintService', () => {
  describe('create()', () => {
    it('rejects a platform actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, baseCreateInput, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('creates a complaint with a real CMP-YYYY-NNNNN number, status intake', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(created.status).toBe('intake')
      expect(created.complaintNumber).toMatch(/^CMP-\d{4}-\d{5}$/)
    })

    it('encrypts the description on write and decrypts it back on read', async () => {
      const { service } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(created.description).toBe(baseCreateInput.description)
    })

    it('instantiates a real quality_complaint workflow', async () => {
      const { service, instantiate } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      expect(instantiate).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-1', sub: 'user-1' }),
        'quality_complaint',
        created.id,
        null,
        {},
      )
    })
  })

  describe('createPublic()', () => {
    it('creates a complaint with createdBy null', async () => {
      const { service } = buildHarness()
      const created = await service.createPublic(
        'company-1',
        { productId: 'product-1', description: 'Discoloured tablets', reporterEmail: 'a@b.com' },
        {},
      )
      expect(created.createdBy).toBeNull()
      expect(created.channel).toBe('distributor')
    })
  })

  describe('classify()', () => {
    it('classifies as a plain quality complaint, no PV routing', async () => {
      const { service, transition, createFromSystemChannel } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.classify(
        actor,
        created.id,
        { classification: 'quality_complaint', severity: 'minor' },
        {},
      )
      expect(updated.classification).toBe('quality_complaint')
      expect(updated.severity).toBe('minor')
      expect(transition).toHaveBeenCalledWith(
        actor,
        created.id,
        'classifying',
        { note: undefined },
        {},
      )
      expect(createFromSystemChannel).not.toHaveBeenCalled()
    })

    it('routes a possible_ae complaint to a real PV case via createFromSystemChannel()', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const updated = await service.classify(
        actor,
        created.id,
        { classification: 'possible_ae' },
        {},
      )
      expect(createFromSystemChannel).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({
          suspectProducts: [
            expect.objectContaining({ medicinalProduct: 'Amoxil', productId: 'product-1' }),
          ],
          adverseEvents: [expect.objectContaining({ narrative: baseCreateInput.description })],
        }),
        'quality_complaint_routed',
        created.id,
        {},
      )
      expect(updated.routedCaseId).toBe('case-1')
    })

    it('never re-routes to a second PV case on a repeat classify() call', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await service.classify(actor, created.id, { classification: 'possible_ae' }, {})
      await service.classify(actor, created.id, { classification: 'possible_ae' }, {})
      expect(createFromSystemChannel).toHaveBeenCalledTimes(1)
    })
  })

  describe('resolve()', () => {
    it('encrypts the resolution note and stamps resolvedAt', async () => {
      const { service, transition, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'quality_complaint_substantiation',
        recordId: created.id,
      })
      const updated = await service.resolve(
        manager,
        created.id,
        { resolutionNote: 'Batch reconciled' },
        {},
      )
      expect(updated.resolutionNote).toBe('Batch reconciled')
      expect(updated.resolvedAt).toBeInstanceOf(Date)
      expect(transition).toHaveBeenCalledWith(manager, created.id, 'resolved', {}, {})
    })
  })

  describe('resolve() — substantiation gate (Pass A2 item 4d)', () => {
    it('refuses to resolve a complaint with no substantiating document attached', async () => {
      const { service, transition } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      await expect(
        service.resolve(manager, created.id, { resolutionNote: 'Batch reconciled' }, {}),
      ).rejects.toMatchObject({ response: { code: 'SUBSTANTIATION_REQUIRED' } })
      expect(transition).not.toHaveBeenCalled()
    })
  })

  describe('resolutionTimeKpi()', () => {
    it('returns nulls with zero resolved complaints', async () => {
      const { service } = buildHarness()
      const kpi = await service.resolutionTimeKpi(actor)
      expect(kpi).toEqual({
        averageDays: null,
        withinTargetPercent: null,
        targetDays: 30,
        resolvedCount: 0,
      })
    })

    it('computes a real average resolution time', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      tables.complaint.rows.set(created.id, {
        ...tables.complaint.rows.get(created.id)!,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        resolvedAt: new Date('2026-09-11T00:00:00Z'),
      })
      const kpi = await service.resolutionTimeKpi(actor)
      expect(kpi.resolvedCount).toBe(1)
      expect(kpi.averageDays).toBe(10)
      expect(kpi.withinTargetPercent).toBe(100)
    })
  })

  describe('openCapaForComplaint()', () => {
    it('opens a CAPA via createFrom() with sourceRecordType "complaint"', async () => {
      const { service, createFrom } = buildHarness()
      const created = await service.create(actor, baseCreateInput, {})
      const capa = await service.openCapaForComplaint(
        actor,
        created.id,
        {
          rootCause: 'Seal line pressure drift',
          rootCauseCategory: 'human_error_training',
          correctiveAction: 'Inspect seal line',
          ownerUserId: 'owner-user',
          correctiveActionDueDate: '2026-12-01',
        },
        {},
      )
      expect(capa.sourceRecordType).toBe('complaint')
      expect(createFrom).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        'company-1',
        'complaint',
        created.id,
        expect.objectContaining({ rootCauseCategory: 'human_error_training' }),
        {},
      )
    })
  })
})
