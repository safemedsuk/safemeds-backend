import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DocumentNumberingService } from './document-numbering.service'
import { SopService } from './sop.service'

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
  const seqCounters = new Map<string, number>()
  const tables = {
    sop: createTable({ status: 'draft', currentVersion: 1 }),
    company: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Pharma Ltd' }) },
    documentNumberingScheme: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest
      .fn()
      .mockImplementation(
        (
          _strings: TemplateStringsArray,
          _id: string,
          companyId: string,
          documentType: string,
          year: number,
        ) => {
          const key = `${companyId}|${documentType}|${year}`
          const next = (seqCounters.get(key) ?? 0) + 1
          seqCounters.set(key, next)
          return Promise.resolve([{ last_value: next }])
        },
      ),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const instantiate = jest.fn().mockResolvedValue(undefined)
  const workflowService = { instantiate } as never

  const service = new SopService(
    rls as never,
    auditService,
    workflowService,
    new DocumentNumberingService(rls as never, auditService),
  )
  return { service, tables, auditLog, instantiate }
}

describe('SopService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(noCompanyActor, { title: 'Deviation Handling', documentType: 'sop' }, {}),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a draft controlled document at version 1 with a server-generated number', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { title: 'Deviation Handling', documentType: 'sop' },
      {},
    )
    expect(created.status).toBe('draft')
    expect(created.currentVersion).toBe(1)
    expect(created.documentNumber).toMatch(/^AP-SOP-\d{4}-0001$/)
  })

  it('increments the generated number per company + type + year, never reusing one', async () => {
    const { service } = buildHarness()
    const first = await service.create(actor, { title: 'A', documentType: 'sop' }, {})
    const second = await service.create(actor, { title: 'B', documentType: 'sop' }, {})
    const other = await service.create(actor, { title: 'C', documentType: 'work_instruction' }, {})
    expect(first.documentNumber.endsWith('-0001')).toBe(true)
    expect(second.documentNumber.endsWith('-0002')).toBe(true)
    expect(other.documentNumber).toMatch(/-WI-\d{4}-0001$/)
  })

  it('404s updating a nonexistent document', async () => {
    const { service } = buildHarness()
    await expect(service.update(actor, 'nonexistent', { title: 'x' }, {})).rejects.toThrow(
      NotFoundException,
    )
  })

  it('edits a draft document', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      { title: 'Deviation Handling', documentType: 'sop' },
      {},
    )
    const updated = await service.update(actor, created.id, { title: 'Deviation Handling v2' }, {})
    expect(updated.title).toBe('Deviation Handling v2')
  })

  it('refuses to edit a document that has left draft (Stage 1 territory)', async () => {
    const { service, tables } = buildHarness()
    const created = await service.create(
      actor,
      { title: 'Deviation Handling', documentType: 'sop' },
      {},
    )
    tables.sop.rows.set(created.id, { ...tables.sop.rows.get(created.id)!, status: 'effective' })
    await expect(service.update(actor, created.id, { title: 'x' }, {})).rejects.toThrow(
      ConflictException,
    )
  })

  it('create() instantiates a real quality_controlled_document workflow', async () => {
    const { service, instantiate } = buildHarness()
    const created = await service.create(
      actor,
      { title: 'Deviation Handling', documentType: 'sop' },
      {},
    )
    expect(instantiate).toHaveBeenCalledWith(
      actor,
      'quality_controlled_document',
      created.id,
      null,
      {},
    )
  })

  describe('reviseNewVersion() — QualCloud Stage 1', () => {
    it('rejects revising a document that is not yet effective', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { title: 'Deviation Handling', documentType: 'sop' },
        {},
      )
      await expect(service.reviseNewVersion(actor, created.id, {})).rejects.toThrow(
        ConflictException,
      )
    })

    it('opens a new draft version referencing the effective document it supersedes', async () => {
      const { service, tables } = buildHarness()
      const created = await service.create(
        actor,
        { title: 'Deviation Handling', documentType: 'sop' },
        {},
      )
      tables.sop.rows.set(created.id, { ...tables.sop.rows.get(created.id)!, status: 'effective' })

      const revised = await service.reviseNewVersion(actor, created.id, {})
      expect(revised.status).toBe('draft')
      expect(revised.currentVersion).toBe(2)
      expect(revised.supersedesDocumentId).toBe(created.id)
      expect(revised.documentNumber).toBe(created.documentNumber)
    })
  })
})
