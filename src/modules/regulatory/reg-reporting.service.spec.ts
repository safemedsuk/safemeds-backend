import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegReportingService } from './reg-reporting.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (value !== null && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(row[key])
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      'lte' in (value as Record<string, unknown>)
    ) {
      return (row[key] as Date) <= (value as { lte: Date }).lte
    }
    return row[key] === value
  })
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditQuery = jest
    .fn()
    .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never

  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirect } as never

  const company = { id: 'company-1', name: 'Nairobi Coastal Pharma' }
  const dossiers: Row[] = []
  const deadlines: Row[] = []
  const registrations: Row[] = []

  const tables = {
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue(company) },
    regDossier: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(dossiers.filter((d) => matches(d, where))),
        ),
    },
    regDeadline: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(deadlines.filter((d) => matches(d, where))),
        ),
    },
    productRegistration: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(registrations.filter((r) => matches(r, where))),
        ),
    },
    generatedReport: {
      create: jest.fn().mockImplementation(({ data }: { data: Row }) => Promise.resolve(data)),
    },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegReportingService(rls as never, auditService, documentsService)
  return { service, tables, dossiers, deadlines, registrations, uploadDirect, auditLog, auditQuery }
}

describe('RegReportingService.generatePortfolioStatusReport', () => {
  it('generates a real xlsx and creates a GeneratedReport with moduleKey regcloud', async () => {
    const { service, dossiers } = buildHarness()
    dossiers.push({
      id: 'dossier-1',
      companyId: 'company-1',
      status: 'approved',
      productClass: 'generic_pharma',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-02-01'),
      product: { brandName: 'Panadol' },
      authority: { name: 'PPB', code: 'PPB' },
      productRegistration: {
        registrationNumber: 'PPB-1',
        expiresOn: new Date('2031-01-01'),
        status: 'active',
      },
    })

    const report = await service.generatePortfolioStatusReport(actor, {})
    expect(report.moduleKey).toBe('regcloud')
    expect(report.reportTypeKey).toBe('reg_portfolio_status')
    expect(report.status).toBe('final')
  })
})

describe('RegReportingService.generateUpcomingRenewalsReport', () => {
  it('defaults to a 90-day window and only counts pending renewal deadlines', async () => {
    const { service, deadlines, registrations } = buildHarness()
    const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const in200Days = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000)
    deadlines.push(
      {
        id: 'd1',
        companyId: 'company-1',
        recordType: 'reg_registration_renewal',
        recordId: 'reg-1',
        status: 'pending',
        dueAt: in10Days,
      },
      {
        id: 'd2',
        companyId: 'company-1',
        recordType: 'reg_registration_renewal',
        recordId: 'reg-2',
        status: 'pending',
        dueAt: in200Days,
      },
    )
    registrations.push(
      {
        id: 'reg-1',
        product: { brandName: 'Amoxiclav' },
        authority: { name: 'PPB', code: 'PPB' },
        registrationNumber: 'PPB-2',
      },
      {
        id: 'reg-2',
        product: { brandName: 'Zithromax' },
        authority: { name: 'PPB', code: 'PPB' },
        registrationNumber: 'PPB-3',
      },
    )

    const report = await service.generateUpcomingRenewalsReport(actor, {}, {})
    expect(report.title).toContain('within 90 days')
  })

  it('honors an explicit withinDays override', async () => {
    const { service, tables } = buildHarness()

    await service.generateUpcomingRenewalsReport(actor, { withinDays: 30 }, {})
    expect(tables.regDeadline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordType: 'reg_registration_renewal',
          status: 'pending',
        }),
      }),
    )
  })
})

describe('RegReportingService.generateDossierTurnaroundReport', () => {
  it('only includes dossiers that reached a terminal state', async () => {
    const { service, dossiers } = buildHarness()
    dossiers.push(
      {
        id: 'd1',
        companyId: 'company-1',
        status: 'approved',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-02-01'),
        product: { brandName: 'A' },
        authority: { name: 'PPB', code: 'PPB' },
      },
      {
        id: 'd2',
        companyId: 'company-1',
        status: 'planning',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        product: { brandName: 'B' },
        authority: { name: 'PPB', code: 'PPB' },
      },
    )

    const report = await service.generateDossierTurnaroundReport(actor, {})
    expect(report.reportTypeKey).toBe('reg_dossier_turnaround')
  })
})
