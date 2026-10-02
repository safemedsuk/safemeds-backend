import { ConflictException, NotFoundException } from '@nestjs/common'

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

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (value && typeof value === 'object' && 'gte' in (value as Record<string, unknown>)) return true
      if (key === 'batch') return true
      if (key === 'regDossier') return true
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
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(rows.get(where.id) ?? null),
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
  return { rows, create, findFirst, findMany, findUnique, count, update }
}

function buildHarness() {
  const pqr = createTable<Row>()
  const product = createTable<Row>()
  const batch = createTable<Row>()
  const deviation = createTable<Row>()
  const complaint = createTable<Row>()
  const changeControl = createTable<Row>()
  const oos = createTable<Row>()
  const regSubmission = createTable<Row>()
  const regVariation = createTable<Row>()
  const qualityTrendFlag = createTable<Row>()
  const capa = createTable<Row>()
  const user = createTable<Row>()
  const company = createTable<Row>()
  const generatedReport = createTable<Row>()
  const stabilityStudy = createTable<Row>()

  const tables = {
    pqr,
    product,
    batch,
    deviation,
    complaint,
    changeControl,
    oos,
    regSubmission,
    regVariation,
    qualityTrendFlag,
    capa,
    user,
    company,
    generatedReport,
    stabilityStudy,
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const uploadDirect = jest.fn().mockResolvedValue(undefined)
  const documentsService = { uploadDirect } as never
  const sign = jest.fn().mockResolvedValue({ id: 'sig-1' })
  const signatureService = { sign } as never
  const createFrom = jest.fn().mockResolvedValue({ id: 'capa-1' })
  const capaService = { createFrom } as never
  const escalateForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { escalateForRecord } as never
  const render = jest.fn().mockResolvedValue(Buffer.from('pdf'))
  const pdfService = { render } as never

  const service = new PqrService(
    rls as never,
    auditService,
    documentsService,
    signatureService,
    capaService,
    tasksService,
    pdfService,
  )
  return { service, tables, auditLog, uploadDirect, sign, createFrom, escalateForRecord }
}

describe('PqrService', () => {
  it('404s assemble() against a product that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.assemble(actor, { productId: 'missing', periodStart: '2026-01-01', periodEnd: '2026-12-31' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('assemble() freezes a live cross-module snapshot and computes a 12-month-out nextReviewDueAt', async () => {
    const { service, tables } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    tables.batch.rows.set('b1', { id: 'b1', companyId: 'company-1', productId: 'p1', manufacturedOn: new Date('2026-03-01') })
    tables.deviation.rows.set('d1', { id: 'd1', companyId: 'company-1', productId: 'p1', detectedAt: new Date('2026-04-01') })
    tables.qualityTrendFlag.rows.set('f1', { id: 'f1', companyId: 'company-1', status: 'open', rootCauseCategory: 'supplier', occurrenceCount: 3 })

    const created = await service.assemble(
      actor,
      { productId: 'p1', periodStart: '2026-01-01', periodEnd: '2026-12-31' },
      {},
    )
    expect(created.status).toBe('draft')
    const assembled = created.assembledData as Record<string, unknown>
    expect(assembled.batchCount).toBe(1)
    expect(assembled.deviationCount).toBe(1)
    expect((assembled.openQualityTrendFlags as string[])[0]).toContain('supplier')
    expect(assembled.stabilityNote).toContain('Not yet applicable')

    const due = created.nextReviewDueAt as Date
    expect(due.getUTCFullYear()).toBe(2027)
    expect(due.getUTCMonth()).toBe(11) // December, 0-indexed
  })

  it('404s review() against a PQR that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.review(actor, 'missing', { intentStatement: 'I attest', signatureToken: 'tok' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('review() rejects a PQR that is already reviewed', async () => {
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
    ).rejects.toThrow(ConflictException)
  })

  it('review() signs, generates+archives a PDF, and opens a CAPA for an action marked openCapa', async () => {
    const { service, tables, sign, uploadDirect, createFrom } = buildHarness()
    tables.product.rows.set('p1', { id: 'p1', companyId: 'company-1', brandName: 'Amoxiclav' })
    tables.company.rows.set('company-1', { id: 'company-1', name: 'Acme Pharma' })
    tables.user.rows.set('user-1', { id: 'user-1', companyId: 'company-1', fullName: 'Jane QA' })
    tables.pqr.rows.set('q1', {
      id: 'q1',
      companyId: 'company-1',
      productId: 'p1',
      status: 'draft',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      assembledData: {
        batchCount: 1,
        deviationCount: 0,
        capaCount: 0,
        oosCount: 0,
        complaintCount: 0,
        changeControlCount: 0,
        regSubmissionCount: 0,
        regVariationCount: 0,
        openQualityTrendFlags: [],
        stabilityNote: 'Not yet applicable',
      },
    })

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
    expect(uploadDirect).toHaveBeenCalled()
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
    expect(tables.pqr.rows.get('q1')?.status).toBe('reviewed')
  })
})
