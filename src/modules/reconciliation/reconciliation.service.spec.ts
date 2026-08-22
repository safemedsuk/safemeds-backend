import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ReconciliationService } from './reconciliation.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

interface CaseRow {
  id: string
  companyId: string
  referenceNumber: string
  receivedDate: Date
  reporter?: { organization: string | null } | null
}
interface DistributorRow {
  id: string
  companyId: string
  name: string
  status: string
  distributorCompanyId?: string | null
}
interface MappingRow {
  id: string
  companyId: string
  caseId: string
  distributorId: string | null
  reconciledBy: string
  reconciledAt: Date
  note: string | null
}

function buildHarness(permissions: string[] = ['reconciliation.manage']) {
  const cases: CaseRow[] = []
  const distributors: DistributorRow[] = []
  const mappings = new Map<string, MappingRow>()
  const reports: Record<string, unknown>[] = []
  const auditLog = jest.fn().mockResolvedValue(undefined)

  const tables = {
    case: {
      findMany: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { companyId: string; receivedDate: { gte: Date; lte: Date } } }) =>
            Promise.resolve(
              cases.filter(
                (c) =>
                  c.companyId === where.companyId &&
                  c.receivedDate >= where.receivedDate.gte &&
                  c.receivedDate <= where.receivedDate.lte,
              ),
            ),
        ),
      count: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { companyId: string; receivedDate: { gte: Date; lte: Date } } }) =>
            Promise.resolve(
              cases.filter(
                (c) =>
                  c.companyId === where.companyId &&
                  c.receivedDate >= where.receivedDate.gte &&
                  c.receivedDate <= where.receivedDate.lte,
              ).length,
            ),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string; companyId: string } }) =>
          Promise.resolve(
            cases.find((c) => c.id === where.id && c.companyId === where.companyId) ?? null,
          ),
        ),
    },
    distributor: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { companyId: string; status?: string } }) =>
          Promise.resolve(
            distributors.filter(
              (d) =>
                d.companyId === where.companyId && (!where.status || d.status === where.status),
            ),
          ),
        ),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string; companyId: string } }) =>
          Promise.resolve(
            distributors.find((d) => d.id === where.id && d.companyId === where.companyId) ?? null,
          ),
        ),
    },
    caseDistributorMapping: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { companyId: string } }) =>
          Promise.resolve([...mappings.values()].filter((m) => m.companyId === where.companyId)),
        ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { caseId: string } }) =>
          Promise.resolve(mappings.get(where.caseId) ?? null),
        ),
      create: jest.fn().mockImplementation(({ data }: { data: MappingRow }) => {
        mappings.set(data.caseId, data)
        return Promise.resolve(data)
      }),
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { caseId: string }; data: Partial<MappingRow> }) => {
            const existing = mappings.get(where.caseId)!
            const updated = { ...existing, ...data }
            mappings.set(where.caseId, updated)
            return Promise.resolve(updated)
          },
        ),
    },
    reconciliationReport: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        reports.push(data)
        return Promise.resolve(data)
      }),
      findMany: jest.fn().mockResolvedValue(reports),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string; companyId: string } }) =>
          Promise.resolve(reports.find((r) => r.id === where.id) ?? null),
        ),
    },
  }

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditService = { log: auditLog } as never
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(permissions))
  const rolesService = { getPermissionsForUser } as never

  const service = new ReconciliationService(rls as never, auditService, rolesService)
  return { service, cases, distributors, mappings, reports, auditLog }
}

const P_START = '2026-08-01'
const P_END = '2026-08-31'

describe('ReconciliationService', () => {
  describe('resolveCaseDistributors (via listUnmatched/generateReport)', () => {
    it('auto-matches a case whose Reporter.organization exactly matches a distributor name, case-insensitively and trimmed', async () => {
      const { service, cases, distributors } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: '  acme distribution  ' },
      })

      const unmatched = await service.listUnmatched(actor, P_START, P_END)
      expect(unmatched).toEqual([])
    })

    it('treats a case with no organization match, or none typed at all, as unmatched', async () => {
      const { service, cases, distributors } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Some Other Org' },
      })
      cases.push({
        id: 'case-2',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00002',
        receivedDate: new Date('2026-08-11'),
        reporter: { organization: null },
      })
      cases.push({
        id: 'case-3',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00003',
        receivedDate: new Date('2026-08-12'),
        reporter: null,
      })

      const unmatched = await service.listUnmatched(actor, P_START, P_END)
      expect(unmatched.map((u) => u.caseId).sort()).toEqual(['case-1', 'case-2', 'case-3'])
    })

    it('excludes a case from the unmatched queue once it has ANY persisted manual mapping — including a confirmed "not distributor-sourced" (null) mapping', async () => {
      const { service, cases, mappings } = buildHarness()
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Nobody Matches This' },
      })
      mappings.set('case-1', {
        id: 'm1',
        companyId: 'company-1',
        caseId: 'case-1',
        distributorId: null,
        reconciledBy: 'user-1',
        reconciledAt: new Date(),
        note: 'Confirmed not distributor-sourced',
      })

      const unmatched = await service.listUnmatched(actor, P_START, P_END)
      expect(unmatched).toEqual([])
    })

    it('a manual mapping overrides what would otherwise be an auto-match', async () => {
      const { service, cases, distributors, mappings } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      distributors.push({
        id: 'dist-2',
        companyId: 'company-1',
        name: 'Beta Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Acme Distribution' },
      })
      mappings.set('case-1', {
        id: 'm1',
        companyId: 'company-1',
        caseId: 'case-1',
        distributorId: 'dist-2',
        reconciledBy: 'user-1',
        reconciledAt: new Date(),
        note: null,
      })

      const report = await service.generateReport(
        actor,
        { periodStart: P_START, periodEnd: P_END },
        {},
      )
      const snapshot = report.snapshot as unknown as {
        byDistributor: { distributorId: string; caseIds: string[] }[]
      }
      expect(snapshot.byDistributor.find((d) => d.distributorId === 'dist-2')?.caseIds).toEqual([
        'case-1',
      ])
      expect(snapshot.byDistributor.find((d) => d.distributorId === 'dist-1')).toBeUndefined()
    })

    it('excludes cases outside the requested period', async () => {
      const { service, cases } = buildHarness()
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-01-01'),
        reporter: { organization: null },
      })

      const unmatched = await service.listUnmatched(actor, P_START, P_END)
      expect(unmatched).toEqual([])
    })
  })

  describe('manuallyReconcileCase()', () => {
    it('creates a mapping and audits it', async () => {
      const { service, cases, distributors, auditLog } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
      })

      const result = await service.manuallyReconcileCase(
        actor,
        'case-1',
        { distributorId: 'dist-1', note: 'Confirmed by phone' },
        {},
      )
      expect(result.distributorId).toBe('dist-1')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'case_distributor_reconciled' }),
      )
    })

    it('allows confirming a case as genuinely not distributor-sourced (distributorId: null)', async () => {
      const { service, cases } = buildHarness()
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
      })

      const result = await service.manuallyReconcileCase(
        actor,
        'case-1',
        { note: 'Direct HCP report, no distributor involved' },
        {},
      )
      expect(result.distributorId).toBeNull()
    })

    it('404s for a case that does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(service.manuallyReconcileCase(actor, 'not-a-real-case', {}, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('404s for a distributorId that does not exist in this company', async () => {
      const { service, cases } = buildHarness()
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
      })
      await expect(
        service.manuallyReconcileCase(
          actor,
          'case-1',
          { distributorId: 'not-a-real-distributor' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('generateReport()', () => {
    it('produces an archived, correctly-totaled snapshot for a whole-company report', async () => {
      const { service, cases, distributors, reports } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Acme Distribution' },
      })
      cases.push({
        id: 'case-2',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00002',
        receivedDate: new Date('2026-08-11'),
        reporter: { organization: 'Unknown Org' },
      })

      const report = await service.generateReport(
        actor,
        { periodStart: P_START, periodEnd: P_END },
        {},
      )
      expect(report.totalCases).toBe(2)
      expect(report.matchedCases).toBe(1)
      expect(report.unmatchedCases).toBe(1)
      expect(reports).toHaveLength(1)
    })

    it('a distributor-scoped report has zero unmatchedCases by definition — unmatched is a whole-company question', async () => {
      const { service, cases, distributors } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Acme Distribution' },
      })
      cases.push({
        id: 'case-2',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00002',
        receivedDate: new Date('2026-08-11'),
        reporter: { organization: 'Totally Unmatched' },
      })

      const report = await service.generateReport(
        actor,
        { distributorId: 'dist-1', periodStart: P_START, periodEnd: P_END },
        {},
      )
      expect(report.matchedCases).toBe(1)
      expect(report.unmatchedCases).toBe(0)
      expect(report.totalCases).toBe(1)
    })

    it('404s for an unknown distributorId', async () => {
      const { service } = buildHarness()
      await expect(
        service.generateReport(
          actor,
          { distributorId: 'not-a-real-distributor', periodStart: P_START, periodEnd: P_END },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('read-access gating', () => {
    it('rejects an actor with no reconciliation permission', async () => {
      const { service } = buildHarness([])
      await expect(service.listUnmatched(actor, P_START, P_END)).rejects.toThrow(ForbiddenException)
    })
  })

  describe('crossTenantSummary()', () => {
    it('rejects when the distributor has no linked tenant company', async () => {
      const { service, distributors } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
        distributorCompanyId: null,
      })
      await expect(service.crossTenantSummary(actor, 'dist-1', P_START, P_END)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('returns both counts and audits the read on BOTH companies when linked', async () => {
      const { service, cases, distributors, auditLog } = buildHarness()
      distributors.push({
        id: 'dist-1',
        companyId: 'company-1',
        name: 'Acme Distribution',
        status: 'active',
        distributorCompanyId: 'distributor-tenant-1',
      })
      cases.push({
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-2026-00001',
        receivedDate: new Date('2026-08-10'),
        reporter: { organization: 'Acme Distribution' },
      })
      cases.push({
        id: 'case-2',
        companyId: 'distributor-tenant-1',
        referenceNumber: 'DT-2026-00001',
        receivedDate: new Date('2026-08-12'),
        reporter: { organization: null },
      })
      cases.push({
        id: 'case-3',
        companyId: 'distributor-tenant-1',
        referenceNumber: 'DT-2026-00002',
        receivedDate: new Date('2026-08-13'),
        reporter: { organization: null },
      })

      const result = await service.crossTenantSummary(actor, 'dist-1', P_START, P_END)
      expect(result.manufacturerMatchedCaseCount).toBe(1)
      expect(result.distributorTenantCaseCount).toBe(2)

      const auditedCompanies = auditLog.mock.calls.map(
        (call) => (call[1] as { companyId: string }).companyId,
      )
      expect(auditedCompanies).toEqual(
        expect.arrayContaining(['company-1', 'distributor-tenant-1']),
      )
      expect(
        auditLog.mock.calls.some((call) => call[1].action === 'reconciliation_cross_tenant_read'),
      ).toBe(true)
      expect(
        auditLog.mock.calls.some(
          (call) => call[1].action === 'reconciliation_cross_tenant_read_by_manufacturer',
        ),
      ).toBe(true)
    })
  })
})
