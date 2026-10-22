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
      'gte' in (value as Record<string, unknown>)
    ) {
      return (row[key] as Date) >= (value as { gte: Date }).gte
    }
    if (value !== null && typeof value === 'object' && 'gt' in (value as Record<string, unknown>)) {
      return (row[key] as Date) > (value as { gt: Date }).gt
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
  dossiersWithVariation?: Row[]
  overdueObligations?: Row[]
  longOpenQueryRows?: Row[]
  productRegistrationsForOpenItems?: Row[]
  auditEntries?: Row[]
  regRetentionsThisMonth?: Row[]
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

  // testing-correction-explanation.md §4.2 — the four "open items" categories, the kind×stage breakdown, and this-month's activity strip.
  const regDossierFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.dossiersWithVariation ?? []).filter((r) => matches(r, where))),
    )
  const regPostMarketObligationFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.overdueObligations ?? []).filter((r) => matches(r, where))),
    )
  const regQueryFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.longOpenQueryRows ?? []).filter((r) => matches(r, where))),
    )
  const productRegistrationFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      // Prisma's include always returns the relation array; default it so fixtures
      // written for the expiring-soon query also satisfy the retention query.
      Promise.resolve(
        (rows.productRegistrationsForOpenItems ?? [])
          .filter((r) => matches(r, where))
          .map((r) => ({ regRetentions: [], ...r })),
      ),
    )
  const regRetentionCount = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.regRetentionsThisMonth ?? []).filter((r) => matches(r, where)).length),
    )
  const auditEntryFindMany = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve((rows.auditEntries ?? []).filter((r) => matches(r, where))),
    )

  const tx = {
    case: { groupBy, findMany: caseFindMany },
    deadline: { count: deadlineCount },
    signal: { count: signalCount },
    generatedReport: { count: reportCount },
    productRegistration: {
      groupBy: registrationGroupBy,
      findFirst: productRegistrationFindFirst,
      findMany: productRegistrationFindMany,
    },
    regDossier: { groupBy: dossierGroupBy, findMany: regDossierFindMany },
    regDeadline: { count: regDeadlineCount },
    regQuery: { count: regQueryCount, findMany: regQueryFindMany },
    regPostMarketObligation: { findMany: regPostMarketObligationFindMany },
    regRetention: { count: regRetentionCount },
    auditEntry: { findMany: auditEntryFindMany },
    product: { findMany: productFindMany },
  }
  const rls = { runAsCompany: (_companyId: string, fn: (t: typeof tx) => unknown) => fn(tx) }

  const countRenewalsDue = jest.fn().mockResolvedValue(2)
  const rmpService = { countRenewalsDue } as never
  const countOpen = jest.fn().mockResolvedValue(1)
  const safetyAlertService = { countOpen } as never
  // QualCloud (Phase 13) Stage 20 — `available: false` by default (no
  // entitlement row in this harness's own tiny `tx`), matching every
  // pre-existing test's own expectation of zero QualCloud involvement.
  const isEnabled = jest.fn().mockResolvedValue(false)
  const entitlementsService = { isEnabled } as never
  const compute = jest.fn().mockResolvedValue({ rightFirstTimeRate: null, recurringIssueCount: 0 })
  const qualityMetricsService = { compute } as never

  const service = new DashboardService(
    rls as never,
    rmpService,
    safetyAlertService,
    entitlementsService,
    qualityMetricsService,
  )
  return { service, isEnabled }
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

    expect(dashboard.qualcloud.available).toBe(false)
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

  // testing-correction-explanation.md §4.2 — Phase 4B.
  describe('dossiersByKindAndStage', () => {
    it("splits a wrapping RegVariation's variationType into renewal vs. variation, and no wrapper at all into registration", async () => {
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        dossiersWithVariation: [
          { id: 'd1', companyId: 'company-1', status: 'compiling', regVariation: null },
          { id: 'd2', companyId: 'company-1', status: 'compiling', regVariation: null },
          {
            id: 'd3',
            companyId: 'company-1',
            status: 'submitted',
            regVariation: { variationType: 'renewal' },
          },
          {
            id: 'd4',
            companyId: 'company-1',
            status: 'submitted',
            regVariation: { variationType: 'minor' },
          },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.dossiersByKindAndStage).toEqual(
        expect.arrayContaining([
          { kind: 'registration', stage: 'compiling', count: 2 },
          { kind: 'renewal', stage: 'submitted', count: 1 },
          { kind: 'variation', stage: 'submitted', count: 1 },
        ]),
      )
    })
  })

  describe('openItems', () => {
    it('lists overdue post-market obligations, each linkable to its own registration', async () => {
      const dueAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        overdueObligations: [
          {
            id: 'o1',
            companyId: 'company-1',
            status: 'overdue',
            obligationType: 'annual_report',
            dueAt,
            productRegistrationId: 'reg-1',
            productRegistration: {
              registrationNumber: 'PPB-2026-0001',
              product: { brandName: 'Depo-Provera' },
            },
          },
          { id: 'o2', companyId: 'company-1', status: 'pending', dueAt },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.openItems.overduePostMarketObligations).toEqual([
        {
          recordType: 'product_registration',
          recordId: 'reg-1',
          label: expect.stringContaining('Depo-Provera (PPB-2026-0001)'),
        },
      ])
    })

    it('surfaces a query open longer than 30 days as a long-open query, but not a recently-opened one', async () => {
      const longAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
      const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        regQueries: [{ id: 'q0', companyId: 'company-1', status: 'open' }],
        longOpenQueryRows: [
          {
            id: 'q1',
            companyId: 'company-1',
            status: 'open',
            receivedDate: longAgo,
            regDossierId: 'dossier-1',
            regDossier: {
              id: 'dossier-1',
              product: { brandName: 'Amoxiclav' },
              authority: { code: 'PPB' },
            },
          },
          {
            id: 'q2',
            companyId: 'company-1',
            status: 'open',
            receivedDate: recent,
            regDossierId: 'dossier-2',
          },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.openItems.longOpenQueries).toEqual([
        {
          recordType: 'reg_dossier',
          recordId: 'dossier-1',
          label: expect.stringContaining('Amoxiclav (PPB)'),
        },
      ])
    })

    it('flags an expiring-soon active registration with no open renewal variation, but not one whose renewal is already underway', async () => {
      const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        productRegistrationsForOpenItems: [
          {
            id: 'reg-no-renewal',
            companyId: 'company-1',
            status: 'active',
            expiresOn: soon,
            registrationNumber: 'PPB-2026-0001',
            product: { brandName: 'Depo-Provera' },
            regVariations: [],
          },
          {
            id: 'reg-renewal-started',
            companyId: 'company-1',
            status: 'active',
            expiresOn: soon,
            registrationNumber: 'PPB-2026-0002',
            product: { brandName: 'Panadol' },
            regVariations: [{ id: 'v1' }],
          },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.openItems.registrationsExpiringSoonWithNoRenewalStarted).toEqual([
        {
          recordType: 'product_registration',
          recordId: 'reg-no-renewal',
          label: expect.stringContaining('Depo-Provera (PPB-2026-0001)'),
        },
      ])
    })

    it('never surfaces a retentions-due item outside the 1 Oct – 31 Dec window', async () => {
      // Pin the clock to mid-June (outside 1 Oct – 31 Dec) so this negative case holds on any real date.
      jest.useFakeTimers({
        now: new Date('2026-06-15T12:00:00Z'),
        doNotFake: [
          'nextTick',
          'queueMicrotask',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'clearTimeout',
          'clearInterval',
          'clearImmediate',
        ],
      })
      try {
        const { service } = buildHarness({
          cases: [],
          deadlines: [],
          signals: [],
          generatedReports: [],
          productRegistrationsForOpenItems: [
            {
              id: 'reg-1',
              companyId: 'company-1',
              status: 'active',
              expiresOn: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000),
              regRetentions: [],
            },
          ],
        })

        const dashboard = await service.getDashboard(actor)
        expect(dashboard.regulatory.openItems.retentionsDueNotLogged).toEqual([])
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('thisMonthActivity', () => {
    it("counts dossiers submitted and approvals received this month from the workflow engine's own state_change audit trail", async () => {
      const thisMonth = new Date()
      const lastMonth = new Date(
        Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 15),
      )
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        auditEntries: [
          {
            id: 'a1',
            companyId: 'company-1',
            recordType: 'reg_registration',
            action: 'state_change',
            occurredAt: thisMonth,
            newValue: { stateKey: 'submitted' },
          },
          {
            id: 'a2',
            companyId: 'company-1',
            recordType: 'reg_registration',
            action: 'state_change',
            occurredAt: thisMonth,
            newValue: { stateKey: 'approved' },
          },
          {
            id: 'a3',
            companyId: 'company-1',
            recordType: 'reg_registration',
            action: 'state_change',
            occurredAt: thisMonth,
            newValue: { stateKey: 'approved' },
          },
          {
            id: 'a4',
            companyId: 'company-1',
            recordType: 'reg_registration',
            action: 'state_change',
            occurredAt: lastMonth,
            newValue: { stateKey: 'submitted' },
          },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.thisMonthActivity.dossiersSubmitted).toBe(1)
      expect(dashboard.regulatory.thisMonthActivity.approvalsReceived).toBe(2)
    })

    it('counts queries logged and retentions certified this month', async () => {
      const thisMonth = new Date()
      const lastMonth = new Date(
        Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 15),
      )
      const { service } = buildHarness({
        cases: [],
        deadlines: [],
        signals: [],
        generatedReports: [],
        regQueries: [
          { id: 'q1', companyId: 'company-1', status: 'open', createdAt: thisMonth },
          { id: 'q2', companyId: 'company-1', status: 'closed', createdAt: lastMonth },
        ],
        regRetentionsThisMonth: [
          { id: 'r1', companyId: 'company-1', createdAt: thisMonth },
          { id: 'r2', companyId: 'company-1', createdAt: lastMonth },
        ],
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.regulatory.thisMonthActivity.queriesLogged).toBe(1)
      expect(dashboard.regulatory.thisMonthActivity.retentionsCertified).toBe(1)
    })
  })
})
