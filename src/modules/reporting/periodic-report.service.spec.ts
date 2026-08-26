import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PeriodicReportService } from './periodic-report.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
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
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = [...list].sort((a, b) => {
            const av = a[field] as Date | null
            const bv = b[field] as Date | null
            const at = av ? av.getTime() : 0
            const bt = bv ? bv.getTime() : 0
            return (at - bt) * (dir === 'desc' ? -1 : 1)
          })
        }
        return Promise.resolve(list[0] ?? null)
      },
    )
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id)
    if (!row) throw new Error('not found')
    return Promise.resolve(row)
  })
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findUniqueOrThrow, update }
}

function buildHarness() {
  const caseFindMany = jest.fn().mockResolvedValue([])
  const signalCount = jest.fn().mockResolvedValue(0)
  const tables = {
    company: createTable(),
    product: createTable(),
    clinicalTrial: createTable(),
    generatedReport: createTable(),
    case: { findMany: caseFindMany },
    signal: { count: signalCount },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'ver-1' } })
  const documentsService = { uploadDirect } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
  const pdfService = { render } as never

  const computeSummary = jest
    .fn()
    .mockResolvedValue({
      subjectId: 'product-1',
      periodStart: null,
      periodEnd: null,
      caseCount: 3,
      seriousnessBreakdown: {},
      expectednessBreakdown: {},
      adverseEventOutcomeBreakdown: {},
      causalityBreakdown: {},
    })
  const computeSummaryForTrial = jest
    .fn()
    .mockResolvedValue({
      subjectId: 'trial-1',
      periodStart: null,
      periodEnd: null,
      caseCount: 1,
      seriousnessBreakdown: {},
      expectednessBreakdown: {},
      adverseEventOutcomeBreakdown: {},
      causalityBreakdown: {},
    })
  const benefitRiskService = { computeSummary, computeSummaryForTrial } as never

  const instantiate = jest.fn().mockResolvedValue({ id: 'instance-1' })
  const workflowService = { instantiate } as never

  const service = new PeriodicReportService(
    rls as never,
    auditService,
    documentsService,
    workflowService,
    pdfService,
    benefitRiskService,
  )
  return { service, tables, computeSummary, render, uploadDirect, instantiate }
}

describe('PeriodicReportService', () => {
  describe('generate() — psur/pbrer (auto EURD cadence)', () => {
    it('generates the first PSUR from the product international birth date once its Data Lock Point is reached', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Depo-Provera',
        internationalBirthDate: new Date('2020-01-01'),
      })

      const report = await service.generate(
        actor,
        { reportTypeKey: 'psur', productId: 'product-1' },
        {},
      )
      expect(report.reportTypeKey).toBe('psur')
      expect(report.periodStart).toEqual(new Date('2020-01-01'))
      expect(report.periodEnd).toEqual(new Date('2020-07-01'))
      expect(report.dueAt).not.toBeNull()
    })

    it('lands at draft, not final, and instantiates a real periodic_report workflow instance (real-usage request, 11 Sep 2026)', async () => {
      const { service, tables, instantiate } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Depo-Provera',
        internationalBirthDate: new Date('2020-01-01'),
      })

      const report = await service.generate(
        actor,
        { reportTypeKey: 'psur', productId: 'product-1' },
        {},
      )
      expect(report.status).toBe('draft')
      expect(report.workflowInstanceId).toBe('instance-1')
      expect(instantiate).toHaveBeenCalledWith(actor, 'periodic_report', report.id, null, {})
    })

    it('rejects a PSUR when the product has no international birth date', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'y',
        internationalBirthDate: null,
      })

      await expect(
        service.generate(actor, { reportTypeKey: 'psur', productId: 'product-1' }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects a PSUR whose next Data Lock Point has not been reached yet', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      const almostNow = new Date()
      almostNow.setDate(almostNow.getDate() - 30) // IBD 30 days ago — the first 6-month DLP is nowhere near reached.
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'y',
        internationalBirthDate: almostNow,
      })

      await expect(
        service.generate(actor, { reportTypeKey: 'psur', productId: 'product-1' }, {}),
      ).rejects.toThrow(ConflictException)
    })

    it('continues the cadence from the previously generated PSUR', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'y',
        internationalBirthDate: new Date('2020-01-01'),
      })
      tables.generatedReport.rows.set('prev-report', {
        id: 'prev-report',
        companyId: 'company-1',
        moduleKey: 'pv',
        reportTypeKey: 'psur',
        recordType: 'product',
        recordId: 'product-1',
        periodStart: new Date('2020-01-01'),
        periodEnd: new Date('2020-07-01'),
      })

      const report = await service.generate(
        actor,
        { reportTypeKey: 'psur', productId: 'product-1' },
        {},
      )
      expect(report.periodStart).toEqual(new Date('2020-07-01'))
      expect(report.periodEnd).toEqual(new Date('2021-01-01'))
    })

    it('rejects with no productId', async () => {
      const { service } = buildHarness()
      await expect(service.generate(actor, { reportTypeKey: 'psur' }, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('404s on an unknown product', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      await expect(
        service.generate(actor, { reportTypeKey: 'psur', productId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('generate() — dsur/pader/cioms_ii (no confirmed cadence, explicit period required)', () => {
    it('rejects pader with no explicit period', async () => {
      const { service } = buildHarness()
      await expect(
        service.generate(actor, { reportTypeKey: 'pader', productId: 'product-1' }, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('generates a pader with an explicit period', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'y',
        internationalBirthDate: null,
      })

      const report = await service.generate(
        actor,
        {
          reportTypeKey: 'pader',
          productId: 'product-1',
          periodStart: '2026-01-01',
          periodEnd: '2026-04-01',
        },
        {},
      )
      expect(report.reportTypeKey).toBe('pader')
      expect(report.dueAt).toBeNull()
    })

    it('requires clinicalTrialId for dsur', async () => {
      const { service } = buildHarness()
      await expect(
        service.generate(
          actor,
          { reportTypeKey: 'dsur', periodStart: '2026-01-01', periodEnd: '2026-04-01' },
          {},
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('generates a dsur scoped to a clinical trial, using computeSummaryForTrial', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.clinicalTrial.rows.set('trial-1', {
        id: 'trial-1',
        companyId: 'company-1',
        trialName: 'Trial One',
      })

      const report = await service.generate(
        actor,
        {
          reportTypeKey: 'dsur',
          clinicalTrialId: 'trial-1',
          periodStart: '2026-01-01',
          periodEnd: '2027-01-01',
        },
        {},
      )
      expect(report.recordType).toBe('clinical_trial')
      expect(report.recordId).toBe('trial-1')
    })
  })

  describe('attachEvidence()', () => {
    it('uploads the file and sets evidenceDocumentId', async () => {
      const { service, tables, uploadDirect } = buildHarness()
      tables.generatedReport.rows.set('report-1', {
        id: 'report-1',
        companyId: 'company-1',
        reportTypeKey: 'psur',
      })

      const updated = await service.attachEvidence(
        actor,
        'report-1',
        { buffer: Buffer.from('x'), originalname: 'proof.pdf', mimetype: 'application/pdf' },
        {},
      )

      expect(uploadDirect).toHaveBeenCalledWith(
        actor,
        'generated_report',
        'report-1',
        expect.objectContaining({ originalname: 'proof.pdf' }),
        { title: 'Submission Evidence' },
        {},
      )
      expect(updated.evidenceDocumentId).toBe('doc-1')
    })

    it('404s on an unknown report', async () => {
      const { service } = buildHarness()
      await expect(
        service.attachEvidence(
          actor,
          'nonexistent',
          { buffer: Buffer.from('x'), originalname: 'x.pdf', mimetype: 'application/pdf' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
