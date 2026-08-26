import { ConflictException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { LineListingService } from './line-listing.service'

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
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (
        key === 'reportType' &&
        typeof value === 'object' &&
        value !== null &&
        'typeKey' in value
      ) {
        return row.reportTypeKey === (value as { typeKey: string }).typeKey
      }
      if (
        key === 'authority' &&
        typeof value === 'object' &&
        value !== null &&
        'countryId' in value
      ) {
        return row.authorityCountryId === (value as { countryId: string }).countryId
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'gte' in (value as Record<string, unknown>)
      ) {
        const rowValue = row[key] as Date
        const range = value as { gte: Date; lte: Date }
        return rowValue >= range.gte && rowValue <= range.lte
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
            const av = (a[field] as Date | null)?.getTime() ?? 0
            const bv = (b[field] as Date | null)?.getTime() ?? 0
            return (av - bv) * (dir === 'desc' ? -1 : 1)
          })
        }
        return Promise.resolve(list[0] ?? null)
      },
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id)
    if (!row) throw new Error('not found')
    return Promise.resolve(row)
  })
  return { rows, create, findFirst, findMany, findUniqueOrThrow }
}

function buildHarness() {
  const tables = {
    country: createTable(),
    company: createTable(),
    reportingRule: createTable(),
    generatedReport: createTable(),
    case: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'ver-1' } })
  const uploadDirectSystem = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'ver-1' } })
  const documentsService = { uploadDirect, uploadDirectSystem } as never

  const service = new LineListingService(rls as never, auditService, documentsService)
  return { service, tables, uploadDirect, uploadDirectSystem }
}

describe('LineListingService', () => {
  describe('generate() — custom range', () => {
    it('generates a line listing for an explicit period, including real case rows', async () => {
      const { service, tables } = buildHarness()
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })
      tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
      tables.case.rows.set('case-1', {
        id: 'case-1',
        companyId: 'company-1',
        countryOfOccurrenceId: 'country-1',
        duplicateOfCaseId: null,
        awarenessDate: new Date('2026-03-01'),
        referenceNumber: 'PV-1',
        seriousnessClass: 'serious',
        reportType: { name: 'Suspected ADR' },
        suspectProducts: [{ medicinalProduct: 'Depo-Provera' }],
        adverseEvents: [{ reportedTerm: 'Injection site reaction' }],
      })

      const report = await service.generate(
        actor,
        { countryId: 'country-1', periodStart: '2026-01-01', periodEnd: '2026-06-01' },
        {},
      )
      expect(report.reportTypeKey).toBe('line_listing')
      expect(report.recordId).toBe('country-1')
    })
  })

  describe('generate() — configured cadence', () => {
    it('rejects when no active line-listing cadence is configured', async () => {
      const { service, tables } = buildHarness()
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })

      await expect(service.generate(actor, { countryId: 'country-1' }, {})).rejects.toThrow(
        ConflictException,
      )
    })

    it('generates from the cadence when the period has already elapsed', async () => {
      const { service, tables } = buildHarness()
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.reportingRule.rows.set('rule-1', {
        id: 'rule-1',
        reportTypeKey: 'line_listing',
        authorityCountryId: 'country-1',
        status: 'active',
        reportingPeriodDays: 28,
      })

      const report = await service.generate(actor, { countryId: 'country-1' }, {})
      expect(report.reportTypeKey).toBe('line_listing')
      // The first-ever period ends at "now" by construction — always immediately due.
      expect(report.periodEnd!.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('rejects when the next configured period has not elapsed yet', async () => {
      const { service, tables } = buildHarness()
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })
      tables.company.rows.set('company-1', { id: 'company-1', name: 'x' })
      tables.reportingRule.rows.set('rule-1', {
        id: 'rule-1',
        reportTypeKey: 'line_listing',
        authorityCountryId: 'country-1',
        status: 'active',
        reportingPeriodDays: 28,
      })
      const recentEnd = new Date()
      recentEnd.setDate(recentEnd.getDate() - 5) // period only 5 days old — the next 28-day period is nowhere near elapsed
      tables.generatedReport.rows.set('prev', {
        id: 'prev',
        companyId: 'company-1',
        moduleKey: 'pv',
        reportTypeKey: 'line_listing',
        recordType: 'country',
        recordId: 'country-1',
        periodEnd: recentEnd,
      })

      await expect(service.generate(actor, { countryId: 'country-1' }, {})).rejects.toThrow(
        ConflictException,
      )
    })
  })

  describe('scanAllCompanies()', () => {
    it('uses the system upload path (no human actor) and generates for each company home country', async () => {
      const { service, tables, uploadDirectSystem, uploadDirect } = buildHarness()
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })
      tables.company.rows.set('company-1', {
        id: 'company-1',
        name: 'x',
        status: 'active',
        homeCountryId: 'country-1',
      })
      tables.reportingRule.rows.set('rule-1', {
        id: 'rule-1',
        reportTypeKey: 'line_listing',
        authorityCountryId: 'country-1',
        status: 'active',
        reportingPeriodDays: 28,
      })

      const result = await service.scanAllCompanies()
      expect(result.generated).toBe(1)
      expect(uploadDirectSystem).toHaveBeenCalledTimes(1)
      expect(uploadDirect).not.toHaveBeenCalled()
    })

    it('is best-effort — a company with no configured cadence does not stop the scan', async () => {
      const { service, tables } = buildHarness()
      tables.company.rows.set('company-1', {
        id: 'company-1',
        name: 'x',
        status: 'active',
        homeCountryId: 'country-1',
      })
      tables.country.rows.set('country-1', { id: 'country-1', name: 'Kenya' })

      const result = await service.scanAllCompanies()
      expect(result.generated).toBe(0)
    })
  })
})
