import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DashboardService } from './dashboard.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
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

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (
      value !== null &&
      typeof value === 'object' &&
      'notIn' in (value as Record<string, unknown>)
    ) {
      return !(value as { notIn: unknown[] }).notIn.includes(row[key])
    }
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
    if (
      value !== null &&
      typeof value === 'object' &&
      'not' in (value as Record<string, unknown>)
    ) {
      return row[key] !== (value as { not: unknown }).not
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      'some' in (value as Record<string, unknown>)
    ) {
      const nested = row[key] as Row[] | undefined
      return (nested ?? []).some((n) =>
        matches(n, (value as { some: Record<string, unknown> }).some),
      )
    }
    // A plain nested-relation filter, e.g. `{ regDossier: { productId: X } }` — matched against a mock row's own same-shaped nested object.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return matches((row[key] as Row) ?? {}, value as Record<string, unknown>)
    }
    return row[key] === value
  })
}

function groupByStatus(
  rows: Row[],
): (args: { where: Record<string, unknown> }) => Promise<{ status: string; _count: number }[]> {
  return ({ where }) => {
    const matching = rows.filter((r) => matches(r, where))
    const counts = new Map<string, number>()
    for (const r of matching) {
      counts.set(r.status as string, (counts.get(r.status as string) ?? 0) + 1)
    }
    return Promise.resolve(
      [...counts.entries()].map(([status, count]) => ({ status, _count: count })),
    )
  }
}

function buildHarness(rows: {
  cases: Row[]
  deadlines: Row[]
  signals: Row[]
  generatedReports: Row[]
  registrations?: Row[]
  dossiers?: Row[]
  regDeadlines?: Row[]
  regQueries?: Row[]
  products?: Row[]
  productRegistrationsByProduct?: Row[]
}) {
  const groupBy = jest.fn().mockImplementation(groupByStatus(rows.cases))
  const caseFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.cases.filter((r) => matches(r, where))),
    )
  const deadlineCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.deadlines.filter((r) => matches(r, where)).length),
    )
  const signalCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.signals.filter((r) => matches(r, where)).length),
    )
  const reportCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.generatedReports.filter((r) => matches(r, where)).length),
    )

  // RegCloud (Phase 12) Stage 17.
  const registrationGroupBy = jest.fn().mockImplementation(groupByStatus(rows.registrations ?? []))
  const dossierGroupBy = jest.fn().mockImplementation(groupByStatus(rows.dossiers ?? []))
  const regDeadlineCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.regDeadlines ?? []).filter((r) => matches(r, where)).length),
    )
  const regQueryCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.regQueries ?? []).filter((r) => matches(r, where)).length),
    )

  // Real-usage request, 11 Sep 2026 — per-product compliance rollup.
  const productFindMany = jest.fn().mockImplementation(() => Promise.resolve(rows.products ?? []))
  const productRegistrationFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const matching = (rows.productRegistrationsByProduct ?? []).filter((r) => matches(r, where))
      return Promise.resolve(
        matching.sort(
          (a, b) => (b.expiresOn as Date).getTime() - (a.expiresOn as Date).getTime(),
        )[0] ?? null,
      )
    })

  const tx = {
    case: { groupBy, findMany: caseFindMany },
    deadline: { count: deadlineCount },
    signal: { count: signalCount },
    generatedReport: { count: reportCount },
    productRegistration: { groupBy: registrationGroupBy, findFirst: productRegistrationFindFirst },
    regDossier: { groupBy: dossierGroupBy },
    regDeadline: { count: regDeadlineCount },
    regQuery: { count: regQueryCount },
    product: { findMany: productFindMany },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (t: typeof tx) => unknown) => fn(tx) }

  const countRenewalsDue = jest.fn().mockResolvedValue(2)
  const rmpService = { countRenewalsDue } as never
  const countOpen = jest.fn().mockResolvedValue(1)
  const safetyAlertService = { countOpen } as never

  const service = new DashboardService(rls as never, rmpService, safetyAlertService)
  return { service }
}

describe('DashboardService', () => {
  it('rejects an actor with no company', async () => {
    const { service } = buildHarness({
      cases: [],
      deadlines: [],
      signals: [],
      generatedReports: [],
    })
    await expect(service.getDashboard(noCompanyActor)).rejects.toThrow(ForbiddenException)
  })

  it('groups open cases by state, excluding the terminal submitted state', async () => {
    const { service } = buildHarness({
      cases: [
        { id: 'c1', companyId: 'company-1', status: 'intake' },
        { id: 'c2', companyId: 'company-1', status: 'intake' },
        { id: 'c3', companyId: 'company-1', status: 'triage' },
        { id: 'c4', companyId: 'company-1', status: 'submitted' },
      ],
      deadlines: [],
      signals: [],
      generatedReports: [],
    })

    const dashboard = await service.getDashboard(actor)
    expect(dashboard.cases.totalOpen).toBe(3)
    expect(dashboard.cases.byState).toEqual(
      expect.arrayContaining([
        { stateKey: 'intake', count: 2 },
        { stateKey: 'triage', count: 1 },
      ]),
    )
  })

  it('counts breached and approaching deadlines', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000) // 1h from now
    const { service } = buildHarness({
      cases: [],
      deadlines: [
        { id: 'd1', companyId: 'company-1', status: 'missed' },
        { id: 'd2', companyId: 'company-1', status: 'pending', dueAt: soon },
      ],
      signals: [],
      generatedReports: [],
    })

    const dashboard = await service.getDashboard(actor)
    expect(dashboard.deadlines.breached).toBe(1)
    expect(dashboard.deadlines.approaching24h).toBe(1)
    expect(dashboard.deadlines.approaching72h).toBe(1)
  })

  it('counts open and freshly-detected signals separately', async () => {
    const { service } = buildHarness({
      cases: [],
      deadlines: [],
      signals: [
        { id: 's1', companyId: 'company-1', status: 'detected' },
        { id: 's2', companyId: 'company-1', status: 'validated' },
        { id: 's3', companyId: 'company-1', status: 'refuted' },
      ],
      generatedReports: [],
    })

    const dashboard = await service.getDashboard(actor)
    expect(dashboard.signals.open).toBe(2)
    expect(dashboard.signals.freshlyDetected).toBe(1)
  })

  it('counts periodic reports and line listings due within the horizon, separately', async () => {
    const soonDue = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const { service } = buildHarness({
      cases: [],
      deadlines: [],
      signals: [],
      generatedReports: [
        {
          id: 'r1',
          companyId: 'company-1',
          moduleKey: 'pv',
          reportTypeKey: 'psur',
          status: 'draft',
          dueAt: soonDue,
        },
        {
          id: 'r2',
          companyId: 'company-1',
          moduleKey: 'pv',
          reportTypeKey: 'line_listing',
          status: 'draft',
          dueAt: soonDue,
        },
        {
          id: 'r3',
          companyId: 'company-1',
          moduleKey: 'pv',
          reportTypeKey: 'psur',
          status: 'submitted',
          dueAt: soonDue,
        },
      ],
    })

    const dashboard = await service.getDashboard(actor)
    expect(dashboard.periodicReportsDue).toBe(1)
    expect(dashboard.lineListingsDue).toBe(1)
  })

  it('reuses RiskManagementPlanService/SafetyAlertService for their own counts', async () => {
    const { service } = buildHarness({
      cases: [],
      deadlines: [],
      signals: [],
      generatedReports: [],
    })
    const dashboard = await service.getDashboard(actor)
    expect(dashboard.rmpRenewalsDue).toBe(2)
    expect(dashboard.safetyAlertsOpen).toBe(1)
  })

  // RegCloud (Phase 12) Stage 17.
  it('extends the dashboard with registration/dossier/renewal/query breakdowns, computed live', async () => {
    const in10d = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const in60d = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    const in120d = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
    const { service } = buildHarness({
      cases: [],
      deadlines: [],
      signals: [],
      generatedReports: [],
      registrations: [
        { id: 'r1', companyId: 'company-1', status: 'active' },
        { id: 'r2', companyId: 'company-1', status: 'active' },
        { id: 'r3', companyId: 'company-1', status: 'expired' },
      ],
      dossiers: [
        { id: 'd1', companyId: 'company-1', status: 'planning' },
        { id: 'd2', companyId: 'company-1', status: 'approved' },
      ],
      regDeadlines: [
        {
          id: 'rd1',
          companyId: 'company-1',
          recordType: 'reg_registration_renewal',
          status: 'pending',
          dueAt: in10d,
        },
        {
          id: 'rd2',
          companyId: 'company-1',
          recordType: 'reg_registration_renewal',
          status: 'pending',
          dueAt: in60d,
        },
        {
          id: 'rd3',
          companyId: 'company-1',
          recordType: 'reg_registration_renewal',
          status: 'pending',
          dueAt: in120d,
        },
      ],
      regQueries: [
        { id: 'rq1', companyId: 'company-1', status: 'open' },
        { id: 'rq2', companyId: 'company-1', status: 'closed' },
      ],
    })

    const dashboard = await service.getDashboard(actor)
    expect(dashboard.regulatory.registrationsByStatus).toEqual(
      expect.arrayContaining([
        { status: 'active', count: 2 },
        { status: 'expired', count: 1 },
      ]),
    )
    expect(dashboard.regulatory.dossiersByStage).toEqual(
      expect.arrayContaining([
        { stage: 'planning', count: 1 },
        { stage: 'approved', count: 1 },
      ]),
    )
    expect(dashboard.regulatory.upcomingRenewals30d).toBe(1)
    expect(dashboard.regulatory.upcomingRenewals90d).toBe(2)
    expect(dashboard.regulatory.openQueries).toBe(1)
  })

  // Real-usage request, 11 Sep 2026 — "every product's live compliance status, what's at risk, what's overdue."
  it('computes a live per-product compliance rollup and an honest QualCloud "not available" flag', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const far = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000)
    const { service } = buildHarness({
      cases: [
        {
          id: 'c1',
          companyId: 'company-1',
          status: 'triage',
          suspectProducts: [{ productId: 'p1' }],
        },
        {
          id: 'c2',
          companyId: 'company-1',
          status: 'submitted',
          suspectProducts: [{ productId: 'p1' }],
        }, // terminal — excluded
      ],
      deadlines: [
        {
          id: 'd1',
          companyId: 'company-1',
          recordType: 'pv_case',
          recordId: 'c1',
          status: 'missed',
        },
      ],
      signals: [],
      generatedReports: [],
      products: [
        { id: 'p1', brandName: 'Depo-Provera' },
        { id: 'p2', brandName: 'Panadol' },
      ],
      productRegistrationsByProduct: [
        { id: 'reg1', companyId: 'company-1', productId: 'p1', status: 'active', expiresOn: soon },
        { id: 'reg2', companyId: 'company-1', productId: 'p2', status: 'active', expiresOn: far },
      ],
      regQueries: [
        { id: 'rq1', companyId: 'company-1', status: 'open', regDossier: { productId: 'p1' } },
      ],
    })

    const dashboard = await service.getDashboard(actor)

    expect(dashboard.qualcloud).toEqual({ available: false })
    expect(dashboard.productCompliance).toHaveLength(2)

    const depo = dashboard.productCompliance.find((p) => p.productId === 'p1')!
    expect(depo.openCases).toBe(1)
    expect(depo.overdueDeadlines).toBe(1)
    expect(depo.registrationStatus).toBe('active')
    expect(depo.registrationExpiringSoon).toBe(true)
    expect(depo.openQueries).toBe(1)

    const panadol = dashboard.productCompliance.find((p) => p.productId === 'p2')!
    expect(panadol.openCases).toBe(0)
    expect(panadol.overdueDeadlines).toBe(0)
    expect(panadol.registrationExpiringSoon).toBe(false)
    expect(panadol.openQueries).toBe(0)
  })
})
