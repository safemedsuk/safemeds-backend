import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AuditReadinessService } from './audit-readiness.service'

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

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (key === 'OR' && Array.isArray(value)) {
        return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        !('gte' in value) &&
        !('contains' in value) &&
        !('in' in value)
      ) {
        // Nested relation filter, e.g. `authority: { countryId }`.
        return matches((row[key] ?? {}) as T, value as Record<string, unknown>)
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'gte' in (value as Record<string, unknown>)
      ) {
        const rowVal = row[key]
        return (
          rowVal !== null &&
          rowVal !== undefined &&
          (rowVal as Date) >= (value as { gte: Date }).gte
        )
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'in' in (value as Record<string, unknown>)
      ) {
        return (value as { in: unknown[] }).in.includes(row[key])
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
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list[0] ?? null)
      },
    )
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
        select,
      }: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        select?: Record<string, boolean>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        if (select) {
          list = list.map((r) => {
            const picked: Row = { id: r.id }
            for (const key of Object.keys(select)) picked[key] = r[key]
            return picked as T
          })
        }
        return Promise.resolve(list)
      },
    )
  const findUnique = jest
    .fn()
    .mockImplementation(
      ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const [key, value] = Object.entries(where)[0]
        const flattened =
          value !== null && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : { [key]: value }
        const found = [...rows.values()].find((r) => matches(r, flattened)) ?? null
        if (found && select) {
          const picked: Row = { id: found.id }
          for (const k of Object.keys(select)) picked[k] = found[k]
          return Promise.resolve(picked)
        }
        return Promise.resolve(found)
      },
    )
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(
      async (args: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const found = (await findUnique(args)) as T | null
        if (!found) throw new Error('not found')
        return found
      },
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const groupBy = jest
    .fn()
    .mockImplementation(({ by, where }: { by: string[]; where?: Record<string, unknown> }) => {
      const field = by[0]
      const list = [...rows.values()].filter((r) => matches(r, where ?? {}))
      const distinct = [...new Set(list.map((r) => r[field]))]
      return Promise.resolve(distinct.map((v) => ({ [field]: v })))
    })
  const upsert = jest
    .fn()
    .mockImplementation(
      ({
        where,
        create: createData,
        update,
      }: {
        where: Record<string, unknown>
        create: T
        update: Partial<T>
      }) => {
        const flattened = Object.values(where)[0] as Record<string, unknown>
        const existing = [...rows.values()].find((r) => matches(r, flattened))
        if (existing) {
          const updated = { ...existing, ...update }
          rows.set(existing.id, updated)
          return Promise.resolve(updated)
        }
        rows.set(createData.id, { ...defaults, ...createData })
        return Promise.resolve(rows.get(createData.id))
      },
    )
  return {
    rows,
    create,
    findFirst,
    findMany,
    findUnique,
    findUniqueOrThrow,
    count,
    groupBy,
    upsert,
  }
}

function buildHarness() {
  const tables = {
    company: createTable(),
    auditRequirementDefinition: createTable({ active: true }),
    auditRequirementRecord: createTable(),
    document: createTable(),
    qppvNomination: createTable(),
    trainingRecord: createTable(),
    psmf: createTable(),
    contactTestAttempt: createTable(),
    distributor: createTable(),
    sdea: createTable(),
    reconciliationReport: createTable(),
    case: createTable(),
    regulatorySubmission: createTable(),
    capa: createTable(),
    callLog: createTable(),
    literatureMonitoringRun: createTable(),
    regulatoryAuthority: createTable(),
    riskManagementPlan: createTable(),
    generatedReport: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new AuditReadinessService(rls as never, auditService)
  return { service, tables, auditLog }
}

function seedCompany(
  tables: ReturnType<typeof buildHarness>['tables'],
  overrides: Record<string, unknown> = {},
) {
  tables.company.rows.set('company-1', {
    id: 'company-1',
    homeCountryId: 'ke',
    homeCountry: { name: 'Kenya' },
    primaryQppvUserId: null,
    ...overrides,
  })
  // testing-todo Stage 16.2-A — `authorityConfigured` reads this table
  // directly now; seeded by default so every pre-existing test (which
  // all implicitly assume a configured authority) keeps working
  // unchanged. The dedicated empty-state test below removes this row.
  if (!tables.regulatoryAuthority.rows.has('auth-ppb')) {
    tables.regulatoryAuthority.rows.set('auth-ppb', {
      id: 'auth-ppb',
      countryId: overrides.homeCountryId ?? 'ke',
    })
  }
}

function seedDefinition(
  tables: ReturnType<typeof buildHarness>['tables'],
  requirementKey: string,
  overrides: Record<string, unknown> = {},
) {
  const id = `def-${requirementKey}`
  tables.auditRequirementDefinition.rows.set(id, {
    id,
    authorityId: 'auth-ppb',
    authority: { countryId: 'ke' },
    requirementKey,
    sortOrder: 1,
    title: requirementKey,
    description: 'desc',
    source: 'system_generated',
    evidenceArtifactType: 'x',
    isMandatory: true,
    active: true,
    ...overrides,
  })
  return id
}

describe('AuditReadinessService', () => {
  describe('getDashboard()', () => {
    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.getDashboard(noCompanyActor)).rejects.toThrow(ForbiddenException)
    })

    it('resolves psmf_in_place as missing with no active PSMF, ready once one exists', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'psmf_in_place')

      const before = await service.getDashboard(actor)
      expect(before.rows[0].status).toBe('missing')

      tables.psmf.rows.set('psmf-1', { id: 'psmf-1', companyId: 'company-1', status: 'active' })
      const after = await service.getDashboard(actor)
      expect(after.rows[0].status).toBe('ready')
    })

    it('resolves qppv_nomination through its full missing -> needs_update -> ready progression', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'qppv_nomination')

      const noQppv = await service.getDashboard(actor)
      expect(noQppv.rows[0].status).toBe('missing')

      seedCompany(tables, { primaryQppvUserId: 'user-qppv' })
      const noNomination = await service.getDashboard(actor)
      expect(noNomination.rows[0].status).toBe('missing')

      tables.qppvNomination.rows.set('nom-1', {
        id: 'nom-1',
        companyId: 'company-1',
        qppvUserId: 'user-qppv',
        role: 'primary',
        status: 'active',
        regulatorConfirmationDocumentId: null,
      })
      const noConfirmation = await service.getDashboard(actor)
      expect(noConfirmation.rows[0].status).toBe('needs_update')

      tables.qppvNomination.rows.set('nom-1', {
        ...tables.qppvNomination.rows.get('nom-1'),
        regulatorConfirmationDocumentId: 'doc-1',
      } as never)
      const ready = await service.getDashboard(actor)
      expect(ready.rows[0].status).toBe('ready')
    })

    it('resolves case_quality_validity as missing with zero cases, ready once at least one exists — the Validity Gate itself is enforced elsewhere', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'case_quality_validity')

      const before = await service.getDashboard(actor)
      expect(before.rows[0].status).toBe('missing')

      tables.case.rows.set('case-1', { id: 'case-1', companyId: 'company-1' })
      const after = await service.getDashboard(actor)
      expect(after.rows[0].status).toBe('ready')
    })

    it('resolves rmp_alignment as missing with no active RMP, ready once one exists for any product', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'rmp_alignment')

      const before = await service.getDashboard(actor)
      expect(before.rows[0].status).toBe('missing')

      tables.riskManagementPlan.rows.set('rmp-1', {
        id: 'rmp-1',
        companyId: 'company-1',
        productId: 'product-1',
        status: 'active',
      })
      const after = await service.getDashboard(actor)
      expect(after.rows[0].status).toBe('ready')
    })

    it('resolves submission_evidence as ready from either a real E2B submission or a real PSUR/PBRER, independently', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'submission_evidence')

      const before = await service.getDashboard(actor)
      expect(before.rows[0].status).toBe('missing')

      tables.generatedReport.rows.set('report-1', {
        id: 'report-1',
        companyId: 'company-1',
        moduleKey: 'pv',
        reportTypeKey: 'psur',
      })
      const afterPsur = await service.getDashboard(actor)
      expect(afterPsur.rows[0].status).toBe('ready')

      tables.generatedReport.rows.clear()
      tables.regulatorySubmission.rows.set('sub-1', { id: 'sub-1', companyId: 'company-1' })
      const afterE2b = await service.getDashboard(actor)
      expect(afterE2b.rows[0].status).toBe('ready')
    })

    it('resolves archiving_retention and ae_log as always ready', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'archiving_retention')
      seedDefinition(tables, 'ae_log')

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows.every((r) => r.status === 'ready')).toBe(true)
    })

    it('resolves literature_monitoring as missing with no run logged, ready once one exists within the currency window', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'literature_monitoring')

      const missing = await service.getDashboard(actor)
      expect(missing.rows[0].status).toBe('missing')
      expect(missing.rows[0].statusNote).toMatch(/no literature-monitoring run/i)

      tables.literatureMonitoringRun.rows.set('run-1', {
        id: 'run-1',
        companyId: 'company-1',
        runAt: new Date(),
      })
      const ready = await service.getDashboard(actor)
      expect(ready.rows[0].status).toBe('ready')
    })

    it('resolves literature_monitoring as missing when the only run is older than the currency window', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'literature_monitoring')

      const staleDate = new Date()
      staleDate.setDate(staleDate.getDate() - 90)
      tables.literatureMonitoringRun.rows.set('run-1', {
        id: 'run-1',
        companyId: 'company-1',
        runAt: staleDate,
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows[0].status).toBe('missing')
    })

    // Real-usage feedback, 19 Aug 2026 — the currency window was corrected
    // from a 35-day guess to the real, sourced 7-day requirement (see
    // `LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS`'s own doc comment). This
    // proves the *new*, tighter threshold specifically — a run 10 days old
    // used to read as "ready" under the old 35-day window and must not
    // anymore.
    it('a run 10 days old is missing under the corrected 7-day window (previously would have read as ready under the old 35-day one)', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'literature_monitoring')

      const tenDaysAgo = new Date()
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10)
      tables.literatureMonitoringRun.rows.set('run-1', {
        id: 'run-1',
        companyId: 'company-1',
        runAt: tenDaysAgo,
      })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows[0].status).toBe('missing')
    })

    it('resolves sdea_contracts as ready when there are no distributors, missing when an active distributor has no active SDEA', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'sdea_contracts')

      const noDistributors = await service.getDashboard(actor)
      expect(noDistributors.rows[0].status).toBe('ready')

      tables.distributor.rows.set('dist-1', {
        id: 'dist-1',
        companyId: 'company-1',
        status: 'active',
      })
      const missingSdea = await service.getDashboard(actor)
      expect(missingSdea.rows[0].status).toBe('missing')

      tables.sdea.rows.set('sdea-1', {
        id: 'sdea-1',
        companyId: 'company-1',
        distributorId: 'dist-1',
        status: 'active',
        expiryDate: null,
      })
      const readyWithSdea = await service.getDashboard(actor)
      expect(readyWithSdea.rows[0].status).toBe('ready')
    })

    it('resolves annual_reconciliation from a recent ReconciliationReport', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'annual_reconciliation')

      const missing = await service.getDashboard(actor)
      expect(missing.rows[0].status).toBe('missing')

      tables.reconciliationReport.rows.set('r1', {
        id: 'r1',
        companyId: 'company-1',
        generatedAt: new Date(),
      })
      const ready = await service.getDashboard(actor)
      expect(ready.rows[0].status).toBe('ready')
    })

    it('resolves internal_audit_capa as needs_update when a CAPA is overdue', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'internal_audit_capa')

      const clean = await service.getDashboard(actor)
      expect(clean.rows[0].status).toBe('ready')

      const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
      tables.capa.rows.set('c1', {
        id: 'c1',
        companyId: 'company-1',
        status: 'open',
        dueDate: past,
        effectivenessCheckDueAt: null,
      })
      const overdue = await service.getDashboard(actor)
      expect(overdue.rows[0].status).toBe('needs_update')
    })

    it('computes the aggregate gauge as red when any mandatory row is missing, green when all ready', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'psmf_in_place')
      seedDefinition(tables, 'ae_log')

      const red = await service.getDashboard(actor)
      expect(red.overall).toBe('red')

      tables.psmf.rows.set('psmf-1', { id: 'psmf-1', companyId: 'company-1', status: 'active' })
      const green = await service.getDashboard(actor)
      expect(green.overall).toBe('green')
    })

    it('testing-todo 16.2-A: reports homeCountryName and authorityConfigured, and never claims green when nothing is configured', async () => {
      const { service, tables } = buildHarness()
      // No seedCompany() authority default — this company's home country
      // genuinely has zero configured authorities, matching the real
      // Cameroon-homed-account scenario the original report was filed
      // against.
      tables.company.rows.set('company-1', {
        id: 'company-1',
        homeCountryId: 'cm',
        homeCountry: { name: 'Cameroon' },
        primaryQppvUserId: null,
      })

      const dashboard = await service.getDashboard(actor)

      expect(dashboard.homeCountryName).toBe('Cameroon')
      expect(dashboard.authorityConfigured).toBe(false)
      expect(dashboard.rows).toHaveLength(0)
      // The real bug this test guards: 0 ready === 0 mandatory is
      // vacuously true, which previously reported a misleading "green"
      // (fully ready) for a company with nothing evaluated at all.
      expect(dashboard.overall).toBe('red')
    })

    it('reports authorityConfigured true and the real home country name for a properly configured company', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'psmf_in_place')
      tables.psmf.rows.set('psmf-1', { id: 'psmf-1', companyId: 'company-1', status: 'active' })

      const dashboard = await service.getDashboard(actor)

      expect(dashboard.homeCountryName).toBe('Kenya')
      expect(dashboard.authorityConfigured).toBe(true)
    })

    it('a person_uploads row with no AuditRequirementRecord degrades to missing', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      seedDefinition(tables, 'qppv_cv_qualifications', { source: 'person_uploads' })

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows[0].status).toBe('missing')
    })
  })

  describe('updateRecord()', () => {
    it('sets a person_uploads row to ready with an evidence document', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      const defId = seedDefinition(tables, 'qppv_cv_qualifications', { source: 'person_uploads' })
      tables.document.rows.set('doc-1', { id: 'doc-1', companyId: 'company-1' })

      await service.updateRecord(actor, defId, { status: 'ready', documentId: 'doc-1' }, {})

      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows[0].status).toBe('ready')
      expect(dashboard.rows[0].evidenceDocumentId).toBe('doc-1')
    })

    it('404s on an unknown definition', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      await expect(service.updateRecord(actor, 'nonexistent', {}, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('404s when the evidence document does not belong to this company', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      const defId = seedDefinition(tables, 'qppv_cv_qualifications', { source: 'person_uploads' })
      await expect(
        service.updateRecord(actor, defId, { documentId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('a note-only override on a system_generated row never changes its live-resolved status', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      const defId = seedDefinition(tables, 'ae_log')

      await service.updateRecord(actor, defId, { note: 'Reviewed manually.' }, {})
      const dashboard = await service.getDashboard(actor)
      expect(dashboard.rows[0].status).toBe('ready')
      expect(dashboard.rows[0].statusNote).toBe('Reviewed manually.')
    })
  })

  describe('exportAeLogCsv()', () => {
    it('produces a CSV with a header row and one row per case', async () => {
      const { service, tables } = buildHarness()
      seedCompany(tables)
      tables.case.rows.set('case-1', {
        id: 'case-1',
        companyId: 'company-1',
        referenceNumber: 'PV-1',
        receivedDate: new Date('2026-01-01'),
        status: 'intake',
        seriousnessClass: 'serious',
      })

      const csv = await service.exportAeLogCsv(actor)
      const lines = csv.split('\n')
      expect(lines[0]).toBe('Reference,Received Date,Status,Seriousness')
      expect(lines[1]).toContain('PV-1')
    })
  })
})
