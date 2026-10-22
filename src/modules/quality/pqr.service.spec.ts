import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PqrService } from './pqr.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

type Bound = { gte?: Date; gt?: Date; lte?: Date; lt?: Date; in?: unknown[]; not?: unknown }

/** Scalar where-matching with real date bounds; relation filters (objects without bound keys) are not applied. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (key === 'OR' || key === 'NOT') return true
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const b = value as Bound
      if (b.gte || b.gt || b.lte || b.lt) {
        const v = row[key] as Date | null | undefined
        if (!v) return false
        const t = v.getTime()
        if (b.gte && t < b.gte.getTime()) return false
        if (b.gt && t <= b.gt.getTime()) return false
        if (b.lte && t > b.lte.getTime()) return false
        if (b.lt && t >= b.lt.getTime()) return false
        return true
      }
      if ('in' in b && Array.isArray(b.in)) return b.in.includes(row[key])
      if ('not' in b) return true
      return true // relation filter
    }
    return row[key] === value
  })
}

function createTable(rowsInit: Row[] = []) {
  const rows = new Map<string, Row>(rowsInit.map((r) => [r.id, r]))
  const create = jest.fn().mockImplementation(({ data }: { data: Row }) => {
    rows.set(data.id, { ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.get(where.id) ?? null),
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const updated = { ...rows.get(where.id)!, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, findUnique, count, update }
}

type Tables = Record<string, ReturnType<typeof createTable>>

/** Any model not explicitly seeded behaves as an empty table, so the collector can query freely. */
function txFor(tables: Tables) {
  return new Proxy(tables, {
    get: (target, key) => {
      if (typeof key !== 'string' || key.startsWith('$') || key === 'then') return undefined
      if (!(key in target)) target[key] = createTable()
      return target[key]
    },
  })
}

function buildHarness() {
  const tables: Tables = {
    pqr: createTable(),
    product: createTable(),
    company: createTable(),
    user: createTable(),
    pqrDocument: createTable(),
    generatedReport: createTable(),
  }
  const tx = txFor(tables)
  const rls = {
    runAsCompany: (_companyId: string, fn: (t: unknown) => unknown) => fn(tx),
    runWithSystemAccess: (fn: (t: unknown) => unknown) => fn(tx),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const uploadDirect = jest.fn().mockResolvedValue(undefined)
  const getDownloadUrl = jest.fn().mockResolvedValue({ url: 'https://files.example/signed' })
  const documentsService = { uploadDirect, getDownloadUrl } as never
  const sign = jest.fn().mockResolvedValue({ id: 'sig-1' })
  const signatureService = { sign } as never
  const createFrom = jest.fn().mockResolvedValue({ id: 'capa-1' })
  const capaService = { createFrom } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
  const pdfService = { render } as never

  const service = new PqrService(
    rls as never,
    { log: auditLog } as never,
    documentsService,
    signatureService,
    capaService,
    tasksService,
    pdfService,
  )
  return { service, tables, auditLog, uploadDirect, getDownloadUrl, sign, createFrom, render }
}

describe('PqrService (Annual Product Quality Review)', () => {
  it('404s assemble() against a product that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.assemble(
        actor,
        { productId: 'missing', periodStart: '2026-01-01', periodEnd: '2026-12-31' },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('rejects a period whose end is before its start', async () => {
    const { service, tables } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    await expect(
      service.assemble(
        actor,
        { productId: 'p1', periodStart: '2026-12-31', periodEnd: '2026-01-01' },
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('defaults to 1 January to 31 December of the current year in UTC when no dates are given', async () => {
    const { service, tables } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    const created = await service.assemble(actor, { productId: 'p1' }, {})
    const year = new Date().getUTCFullYear()
    expect(created.periodStart.toISOString().slice(0, 10)).toBe(`${year}-01-01`)
    expect(created.periodEnd.toISOString().slice(0, 10)).toBe(`${year}-12-31`)
  })

  it('freezes a snapshot that includes a deviation logged on the last day of the period', async () => {
    const { service, tables } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    tables.pqr.rows.clear()
    const dev = createTable()
    tables.deviation = dev
    dev.rows.set('d1', {
      id: 'd1',
      companyId: 'company-1',
      productId: 'p1',
      deviationNumber: 'DEV-2026-0001',
      title: 'Seal leak',
      status: 'closed',
      severity: 'major',
      detectedAt: new Date('2026-12-31T15:00:00Z'),
      closedAt: null,
    })
    const created = await service.assemble(
      actor,
      { productId: 'p1', periodStart: '2026-01-01', periodEnd: '2026-12-31' },
      {},
    )
    const assembled = created.assembledData as {
      deviationCount: number
      snapshot: { deviations: { ref: string }[] }
    }
    expect(assembled.deviationCount).toBe(1)
    expect(assembled.snapshot.deviations[0].ref).toBe('DEV-2026-0001')
    expect(created.status).toBe('draft')
    const due = created.nextReviewDueAt as Date
    expect(due.getUTCFullYear()).toBe(2027)
    expect(due.getUTCMonth()).toBe(11)
  })

  it('404s review() against an APQR that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.review(actor, 'missing', { intentStatement: 'I attest', signatureToken: 'tok' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('review() rejects an APQR that is already reviewed', async () => {
    const { service, tables } = buildHarness()
    tables.pqr.rows.set('q1', {
      id: 'q1',
      companyId: 'company-1',
      productId: 'p1',
      status: 'reviewed',
      assembledData: {},
    })
    await expect(
      service.review(actor, 'q1', { intentStatement: 'I attest', signatureToken: 'tok' }, {}),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  const draftRow = () => ({
    id: 'q1',
    companyId: 'company-1',
    productId: 'p1',
    status: 'draft',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-12-31'),
    assembledData: {
      batchCount: 0,
      deviationCount: 0,
      capaCount: 0,
      oosCount: 0,
      complaintCount: 0,
      changeControlCount: 0,
      recallCount: 0,
      regSubmissionCount: 0,
      regVariationCount: 0,
      openQualityTrendFlags: [],
      stabilityNote: 'Not yet applicable',
      snapshot: {
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T00:00:00.000Z',
        batches: [],
        deviations: [],
        capas: [],
        oos: [],
        complaints: [],
        changeControls: [],
        recalls: [],
        returns: [],
        stability: [],
        environmental: [],
        equipment: [],
        training: {
          totalRecords: 0,
          expired: 0,
          expiringWithin30Days: 0,
          asOf: '2026-10-05T00:00:00.000Z',
        },
        suppliers: [],
        regulatory: [],
      },
    },
  })

  it('review() signs, opens the requested CAPA, and archives BOTH a PDF and an Excel workbook', async () => {
    const { service, tables, sign, uploadDirect, createFrom, render } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    tables.company.rows.set('company-1', { id: 'company-1', name: 'Acme Pharma' })
    tables.user.rows.set('user-1', { id: 'user-1', companyId: 'company-1', fullName: 'Jane QA' })
    tables.pqr.rows.set('q1', draftRow())

    const result = await service.review(
      actor,
      'q1',
      {
        intentStatement: 'I attest this review is accurate',
        signatureToken: 'tok-1',
        conclusionsNarrative: 'All within expectations',
        recommendedActions: [{ description: 'Tighten supplier audit cadence', openCapa: true }],
      },
      {},
    )

    expect(sign).toHaveBeenCalled()
    expect(render).toHaveBeenCalledTimes(1)
    expect(uploadDirect).toHaveBeenCalledTimes(2)
    const kinds = uploadDirect.mock.calls.map(
      (c) => (c[2] as string) && (c[3] as { mimetype: string }).mimetype,
    )
    expect(kinds).toEqual(
      expect.arrayContaining(['application/pdf', expect.stringContaining('spreadsheetml')]),
    )
    expect(createFrom).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      'company-1',
      'pqr_action',
      'q1',
      expect.objectContaining({ correctiveAction: 'Tighten supplier audit cadence' }),
      {},
    )
    expect(result.generatedReportId).toBeTruthy()
    expect(result.excelGeneratedReportId).toBeTruthy()
    expect(result.generatedReportId).not.toBe(result.excelGeneratedReportId)
    expect(tables.pqr.rows.get('q1')?.status).toBe('reviewed')
  })

  it('download() refuses a draft, and returns the archived file link for a signed APQR with an audit entry', async () => {
    const { service, tables, getDownloadUrl, auditLog } = buildHarness()
    tables.pqr.rows.set('q1', {
      ...draftRow(),
      generatedReportId: 'r-pdf',
      excelGeneratedReportId: 'r-xlsx',
    })
    await expect(service.download(actor, 'q1', 'pdf', {})).rejects.toBeInstanceOf(ConflictException)

    tables.pqr.rows.set('q1', {
      ...draftRow(),
      status: 'reviewed',
      generatedReportId: 'r-pdf',
      excelGeneratedReportId: 'r-xlsx',
    })
    const documentTable = createTable()
    tables.document = documentTable
    documentTable.rows.set('doc-x', {
      id: 'doc-x',
      companyId: 'company-1',
      recordType: 'generated_report',
      recordId: 'r-xlsx',
      versions: [{ id: 'v-1', status: 'stored' }],
    })
    const out = await service.download(actor, 'q1', 'xlsx', {})
    expect(out.url).toBe('https://files.example/signed')
    expect(out.filename).toBe('apqr.xlsx')
    expect(getDownloadUrl).toHaveBeenCalledWith(actor, 'doc-x', 'v-1')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'apqr_downloaded' }),
    )
  })
})
