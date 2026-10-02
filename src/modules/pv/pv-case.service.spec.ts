import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreatePvCaseDto } from './dto/create-pv-case.dto'
import { PvCaseService } from './pv-case.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['DISPENSING_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

const otherUserSameCompany: AuthenticatedUser = { ...actor, sub: 'user-2' }
const otherCompanyActor: AuthenticatedUser = { ...actor, sub: 'user-3', companyId: 'company-2' }
const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>() {
  const rows = new Map<string, T>()
  let counter = 0

  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (
        value !== null &&
        typeof value === 'object' &&
        'contains' in (value as Record<string, unknown>)
      ) {
        const clause = value as { contains: string; mode?: string }
        const rowVal = typeof row[key] === 'string' ? row[key] : ''
        return clause.mode === 'insensitive'
          ? rowVal.toLowerCase().includes(clause.contains.toLowerCase())
          : rowVal.includes(clause.contains)
      }
      return row[key] === value
    })
  }

  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    const row = { ...data, createdAt: data.createdAt ?? new Date(Date.now() + counter++) } as T
    rows.set(row.id, row)
    return Promise.resolve(row)
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const found = [...rows.values()].find((r) => matches(r, where))
      return Promise.resolve(found ?? null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        skip,
        take,
        orderBy,
      }: {
        where?: Record<string, unknown>
        skip?: number
        take?: number
        orderBy?: { createdAt: 'desc' }
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy?.createdAt === 'desc') {
          list = list.sort(
            (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
          )
        }
        if (skip !== undefined || take !== undefined) {
          list = list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length))
        }
        return Promise.resolve(list)
      },
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

  return { rows, create, findFirst, findMany, count, update }
}

/** Seeded with the two countries this file's fixtures use — Kenya for 'country-1' (the default), Cameroon for 'country-2' (used by the reference-number-format tests to prove the report/occurrence halves can genuinely differ). */
function buildCountryTable() {
  const rows = new Map<string, { id: string; isoCode: string }>([
    ['country-1', { id: 'country-1', isoCode: 'KE' }],
    ['country-2', { id: 'country-2', isoCode: 'CM' }],
  ])
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const found = rows.get(where.id)
    if (!found) throw new Error(`country ${where.id} not found`)
    return Promise.resolve(found)
  })
  return { rows, findUniqueOrThrow }
}

function buildHarness(permissions: string[] = ['pv.capture_case']) {
  const tables = {
    case: createTable(),
    country: buildCountryTable(),
    reporter: createTable(),
    patient: createTable(),
    suspectProduct: createTable(),
    adverseEvent: createTable(),
    causalityAssessment: createTable(),
    sourceDocument: createTable(),
    document: createTable(),
    pregnancyContext: createTable(),
    clinicalTrial: createTable(),
    clinicalTrialSubject: createTable(),
    reportType: createTable(),
    // `get()` (Stage 4/5) reads these two too — no test in this file
    // exercises deadline/live-workflow-status content, so a plain
    // always-null stub is enough to keep `get()` from throwing.
    deadline: { findUnique: jest.fn().mockResolvedValue(null) },
    workflowInstance: { findFirst: jest.fn().mockResolvedValue(null) },
  }

  // `Case.status` has a real DB-level `@default("intake")` in production —
  // the generic `createTable()` mock has no concept of column defaults, so
  // this wraps `case.create` to apply the same default whenever `status`
  // isn't explicitly passed, matching what a real `tx.case.create()` call
  // (e.g. `buildCaseGraph()`'s own, which never sets `status` itself)
  // would actually produce. Needed for `requireCaseAtIntake()`'s tests.
  const baseCaseCreate = tables.case.create
  tables.case.create = jest
    .fn()
    .mockImplementation(({ data }: { data: Row }): Promise<Row> =>
      baseCaseCreate({ data: { status: 'intake', ...data } }),
    ) as never

  // `PvCaseService.get()` fetches the case with a Prisma `include` for its
  // relations — the generic `createTable()` mock has no join support, so
  // this wraps `case.findFirst` to hydrate the relation arrays/objects
  // itself whenever an `include` option is passed, mirroring what Prisma
  // would actually return.
  const baseCaseFindFirst = tables.case.findFirst
  tables.case.findFirst = jest
    .fn()
    .mockImplementation(
      async (args: { where: Record<string, unknown>; include?: Record<string, boolean> }) => {
        const found = (await baseCaseFindFirst(args)) as (Row & Record<string, unknown>) | null
        if (!found || !args.include) return found

        const caseId = found.id
        return {
          ...found,
          ...(args.include.reporter
            ? {
                reporter:
                  [...tables.reporter.rows.values()].find((r) => r.caseId === caseId) ?? null,
              }
            : {}),
          ...(args.include.patient
            ? {
                patient: [...tables.patient.rows.values()].find((r) => r.caseId === caseId) ?? null,
              }
            : {}),
          ...(args.include.suspectProducts
            ? {
                suspectProducts: [...tables.suspectProduct.rows.values()].filter(
                  (r) => r.caseId === caseId,
                ),
              }
            : {}),
          ...(args.include.adverseEvents
            ? {
                adverseEvents: [...tables.adverseEvent.rows.values()].filter(
                  (r) => r.caseId === caseId,
                ),
              }
            : {}),
          ...(args.include.causalityAssessments
            ? {
                causalityAssessments: [...tables.causalityAssessment.rows.values()].filter(
                  (r) => r.caseId === caseId,
                ),
              }
            : {}),
          ...(args.include.pregnancyContext
            ? {
                pregnancyContext:
                  [...tables.pregnancyContext.rows.values()].find((r) => r.caseId === caseId) ??
                  null,
              }
            : {}),
          ...(args.include.reportType
            ? {
                reportType:
                  [...tables.reportType.rows.values()].find((r) => r.id === found.reportTypeId) ??
                  null,
              }
            : {}),
        }
      },
    ) as never

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  // testing-todo Stage 17.1 — `get()`'s own Decision History read; empty
  // by default so every pre-existing test (none of which care about
  // transition history) keeps working unchanged.
  const auditQuery = jest
    .fn()
    .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never
  const textEncryption = {
    encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decrypt: jest.fn((ciphertext: string) => ciphertext.replace(/^enc\(/, '').replace(/\)$/, '')),
  } as never
  const consentCapture = jest.fn().mockResolvedValue({ id: 'consent-1' })
  const consentCaptureSystem = jest.fn().mockResolvedValue({ id: 'consent-1' })
  const consentService = { capture: consentCapture, captureSystem: consentCaptureSystem } as never
  const createVersion = jest.fn().mockResolvedValue({ id: 'version-1' })
  const recordVersioningService = { createVersion } as never
  const instantiate = jest.fn().mockResolvedValue({ id: 'workflow-instance-1' })
  const workflowService = { instantiate } as never
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(permissions))
  const rolesService = { getPermissionsForUser } as never
  const evaluateInTx = jest.fn().mockResolvedValue({ allowed: true, criteria: [] })
  const validityGateService = { evaluateInTx } as never

  const duplicateDetectionService = { screenInTx: jest.fn().mockResolvedValue([]) } as never
  const service = new PvCaseService(
    rls as never,
    auditService,
    textEncryption,
    consentService,
    recordVersioningService,
    workflowService,
    rolesService,
    validityGateService,
    duplicateDetectionService,
  )
  return {
    service,
    tables,
    auditLog,
    auditQuery,
    textEncryption,
    consentCapture,
    consentCaptureSystem,
    createVersion,
    instantiate,
    getPermissionsForUser,
  }
}

function baseDto(overrides: Partial<CreatePvCaseDto> = {}): CreatePvCaseDto {
  return {
    reportTypeId: 'report-type-1',
    countryOfOccurrenceId: 'country-1',
    countryOfReportId: 'country-1',
    channel: 'form',
    awarenessDate: '2026-08-01',
    receivedDate: '2026-08-02',
    additionalInformation: 'Some extra context',
    reporter: {
      reporterType: 'healthcare_professional',
      fullName: 'Dr. Jane',
      email: 'jane@example.com',
    },
    patient: { initials: 'J.M.', ageYears: 34, sex: 'female', medicalHistory: 'Hypertension' },
    suspectProducts: [
      { drugCharacterization: 'suspect', medicinalProduct: 'Panadol' },
      { drugCharacterization: 'concomitant', medicinalProduct: 'Amoxil' },
    ],
    adverseEvents: [
      { reportedTerm: 'Rash', narrative: 'Patient developed a rash within 2 hours' },
      {
        reportedTerm: 'Nausea',
        narrative: 'Patient felt nauseous',
        seriousnessHospitalization: true,
      },
    ],
    ...overrides,
  }
}

describe('PvCaseService', () => {
  describe('create()', () => {
    it('builds the full intake graph, encrypts free text, and wires every Stage 0 primitive', async () => {
      const { service, tables, auditLog, consentCapture, createVersion, instantiate } =
        buildHarness()

      const result = await service.create(
        actor,
        baseDto({ consent: { granted: true, method: 'written' } }),
        { ip: '1.2.3.4' },
      )

      // Real-usage request, 22 Sep 2026 — {reportISO3}-{year}-{occurrenceISO3}-{5 digits}. Both country halves are Kenya here (`baseDto()`'s default), matching a domestic case.
      expect(result.referenceNumber).toMatch(/^KEN-\d{4}-KEN-\d{5}$/)
      expect(result.additionalInformation).toBe('Some extra context')
      expect(tables.reporter.rows.size).toBe(1)
      expect(tables.patient.rows.size).toBe(1)
      expect(tables.suspectProduct.rows.size).toBe(2)
      expect(tables.adverseEvent.rows.size).toBe(2)
      // 2 suspect products x 2 adverse events = 4 causality pairs.
      expect(tables.causalityAssessment.rows.size).toBe(4)

      const [patient] = [...tables.patient.rows.values()]
      expect(patient.medicalHistoryEncrypted).toBe('enc(Hypertension)')
      const [event] = [...tables.adverseEvent.rows.values()]
      expect(event.narrativeEncrypted).toMatch(/^enc\(/)

      // The response itself carries the real decrypted values back, not the ciphertext — see `decryptCase()`'s own doc comment for the bug this fixes.
      expect(result.patient!.medicalHistory).toBe('Hypertension')
      expect(
        (result.patient as unknown as Record<string, unknown>).medicalHistoryEncrypted,
      ).toBeUndefined()
      expect(result.adverseEvents.map((e) => e.narrative).sort()).toEqual(
        ['Patient developed a rash within 2 hours', 'Patient felt nauseous'].sort(),
      )
      expect(
        (result as unknown as Record<string, unknown>).additionalInformationEncrypted,
      ).toBeUndefined()

      expect(consentCapture).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          recordType: 'pv_case',
          recordId: result.id,
          consentType: 'report',
          granted: true,
          method: 'written',
        }),
        { ip: '1.2.3.4' },
      )
      expect(createVersion).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          recordType: 'pv_case',
          recordId: result.id,
          reason: 'Case created',
        }),
        { ip: '1.2.3.4' },
      )
      expect(instantiate).toHaveBeenCalledWith(actor, 'pv_case', result.id, dtoCountry(), {
        ip: '1.2.3.4',
      })
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_created', recordId: result.id }),
      )

      function dtoCountry() {
        return 'country-1'
      }
    })

    it('does not capture consent when the caller omits it', async () => {
      const { service, consentCapture } = buildHarness()
      await service.create(actor, baseDto(), {})
      expect(consentCapture).not.toHaveBeenCalled()
    })

    it("captures a genuinely separate 'contact' consent record, distinct from 'report' consent (real-usage bug, 22 Sep 2026)", async () => {
      const { service, consentCapture } = buildHarness()

      const result = await service.create(
        actor,
        baseDto({
          consent: { granted: true, method: 'written' },
          contactConsent: { granted: true, method: 'verbal' },
        }),
        { ip: '1.2.3.4' },
      )

      expect(consentCapture).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ recordId: result.id, consentType: 'report', granted: true, method: 'written' }),
        { ip: '1.2.3.4' },
      )
      expect(consentCapture).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ recordId: result.id, consentType: 'contact', granted: true, method: 'verbal' }),
        { ip: '1.2.3.4' },
      )
      expect(consentCapture).toHaveBeenCalledTimes(2)
    })

    it('captures only report consent, never contact, when contactConsent is omitted', async () => {
      const { service, consentCapture } = buildHarness()
      await service.create(actor, baseDto({ consent: { granted: true, method: 'written' } }), {})
      expect(consentCapture).toHaveBeenCalledTimes(1)
      expect(consentCapture).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ consentType: 'report' }),
        {},
      )
    })

    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      await expect(service.create(platformActor, baseDto(), {})).rejects.toThrow(ForbiddenException)
    })

    it('generates distinct reference numbers for successive cases', async () => {
      const { service } = buildHarness()
      const first = await service.create(actor, baseDto(), {})
      const second = await service.create(actor, baseDto(), {})
      expect(first.referenceNumber).not.toBe(second.referenceNumber)
    })

    describe('reference number format (real-usage request, 22 Sep 2026)', () => {
      it('uses each country field\'s own ISO3 code independently — a foreign case genuinely differs on each half', async () => {
        const { service } = buildHarness()
        const result = await service.create(
          actor,
          baseDto({ countryOfReportId: 'country-1', countryOfOccurrenceId: 'country-2' }),
          {},
        )
        expect(result.referenceNumber).toMatch(/^KEN-\d{4}-CMR-\d{5}$/)
      })

      it('encodes the real current day-of-year in the first 3 digits of the suffix', async () => {
        const { service } = buildHarness()
        const result = await service.create(actor, baseDto(), {})
        const now = new Date()
        const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
        const [, , , suffix] = result.referenceNumber.split('-')
        expect(suffix.slice(0, 3)).toBe(dayOfYear.toString().padStart(3, '0'))
      })

      it('increments the last-2-digit same-day sequence across successive cases for the same company, same day', async () => {
        const { service } = buildHarness()
        const first = await service.create(actor, baseDto(), {})
        const second = await service.create(actor, baseDto(), {})
        const third = await service.create(actor, baseDto(), {})
        const seqOf = (ref: string) => Number(ref.split('-')[3].slice(3))
        expect([seqOf(first.referenceNumber), seqOf(second.referenceNumber), seqOf(third.referenceNumber)]).toEqual([0, 1, 2])
      })

      it('scopes the same-day sequence per company, not globally', async () => {
        const { service } = buildHarness()
        const otherCompanyOwnActor: AuthenticatedUser = { ...actor, companyId: 'company-9', sub: 'user-9' }

        const a = await service.create(actor, baseDto(), {})
        const b = await service.create(otherCompanyOwnActor, baseDto(), {})
        const c = await service.create(actor, baseDto(), {})

        expect(a.referenceNumber.split('-')[3].slice(3)).toBe('00')
        // Company 9's own first case today also starts at 00 — it never sees company 1's count.
        expect(b.referenceNumber.split('-')[3].slice(3)).toBe('00')
        // Company 1's second case picks up right where its own sequence left off.
        expect(c.referenceNumber.split('-')[3].slice(3)).toBe('01')
      })
    })

    // VigiCloud Stage 14 — solicited-intake validation.
    describe('clinical-trial SAE intake (Stage 14)', () => {
      it('rejects a clinical_study-channel case with no clinicalTrialId — solicited data always traces back to a trial', async () => {
        const { service } = buildHarness()
        await expect(
          service.create(actor, baseDto({ channel: 'clinical_study' }), {}),
        ).rejects.toThrow('clinicalTrialId')
      })

      it('404s when clinicalTrialId does not resolve to a real trial in this company', async () => {
        const { service } = buildHarness()
        await expect(
          service.create(
            actor,
            baseDto({ channel: 'clinical_study', clinicalTrialId: 'not-a-real-trial' }),
            {},
          ),
        ).rejects.toThrow(NotFoundException)
      })

      it('404s when clinicalTrialSubjectId does not belong to the given clinicalTrialId', async () => {
        const { service, tables } = buildHarness()
        tables.clinicalTrial.rows.set('trial-1', { id: 'trial-1', companyId: 'company-1' })
        tables.clinicalTrialSubject.rows.set('subject-1', {
          id: 'subject-1',
          companyId: 'company-1',
          clinicalTrialId: 'a-different-trial',
        })

        await expect(
          service.create(
            actor,
            baseDto({
              channel: 'clinical_study',
              clinicalTrialId: 'trial-1',
              clinicalTrialSubjectId: 'subject-1',
            }),
            {},
          ),
        ).rejects.toThrow(NotFoundException)
      })

      it('succeeds and stamps clinicalTrialId/clinicalTrialSubjectId onto the case when everything resolves', async () => {
        const { service, tables } = buildHarness()
        tables.clinicalTrial.rows.set('trial-1', { id: 'trial-1', companyId: 'company-1' })
        tables.clinicalTrialSubject.rows.set('subject-1', {
          id: 'subject-1',
          companyId: 'company-1',
          clinicalTrialId: 'trial-1',
        })

        const result = await service.create(
          actor,
          baseDto({
            channel: 'clinical_study',
            clinicalTrialId: 'trial-1',
            clinicalTrialSubjectId: 'subject-1',
          }),
          {},
        )

        expect(result.clinicalTrialId).toBe('trial-1')
        expect(result.clinicalTrialSubjectId).toBe('subject-1')
      })

      it('does not require clinicalTrialSubjectId even on a clinical-trial case — a case can describe a subject who was never pre-registered', async () => {
        const { service, tables } = buildHarness()
        tables.clinicalTrial.rows.set('trial-1', { id: 'trial-1', companyId: 'company-1' })

        const result = await service.create(
          actor,
          baseDto({ channel: 'clinical_study', clinicalTrialId: 'trial-1' }),
          {},
        )
        expect(result.clinicalTrialId).toBe('trial-1')
        expect(result.clinicalTrialSubjectId).toBeNull()
      })

      it('never requires a clinicalTrialId on any other channel', async () => {
        const { service } = buildHarness()
        const result = await service.create(actor, baseDto({ channel: 'form' }), {})
        expect(result.clinicalTrialId).toBeNull()
      })
    })
  })

  describe('get()', () => {
    it('returns the full graph for an actor with pv.view_all', async () => {
      const creatorHarness = buildHarness()
      const created = await creatorHarness.service.create(actor, baseDto(), {})

      const { tables } = buildHarness(['pv.view_all'])
      // Reuse the same in-memory tables the case was created against.
      const viewer = new PvCaseService(
        {
          runAsCompany: (_c: string, fn: (tx: typeof tables) => unknown) =>
            fn(creatorHarness.tables),
        } as never,
        {
          log: jest.fn().mockResolvedValue(undefined),
          query: jest
            .fn()
            .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } }),
        } as never,
        { encrypt: jest.fn((s: string) => s), decrypt: jest.fn() } as never,
        { capture: jest.fn() } as never,
        { createVersion: jest.fn() } as never,
        { instantiate: jest.fn() } as never,
        { getPermissionsForUser: jest.fn().mockResolvedValue(new Set(['pv.view_all'])) } as never,
        { evaluateInTx: jest.fn().mockResolvedValue({ allowed: true, criteria: [] }) } as never,
        { screenInTx: jest.fn().mockResolvedValue([]) } as never,
      )

      const found = await viewer.get(otherUserSameCompany, created.id)
      expect(found.id).toBe(created.id)
      expect(found.suspectProducts).toHaveLength(2)
    })

    it('joins in the report type — task 1.1, so the case detail page can show which report type was selected at intake', async () => {
      const harness = buildHarness()
      harness.tables.reportType.rows.set('report-type-1', {
        id: 'report-type-1',
        typeKey: 'adr',
        name: 'Suspected Adverse Drug Reaction',
        moduleKey: 'pv',
      })
      const created = await harness.service.create(actor, baseDto(), {})

      const found = await harness.service.get(actor, created.id)
      expect(found.reportType).toEqual(
        expect.objectContaining({ id: 'report-type-1', name: 'Suspected Adverse Drug Reaction' }),
      )
    })

    it('testing-todo 17.1: returns transitionHistory from the audit trail, mapped from state_change entries', async () => {
      const { service, auditQuery } = buildHarness()
      const created = await service.create(actor, baseDto(), {})
      auditQuery.mockResolvedValueOnce({
        data: [
          {
            oldValue: { stateKey: 'intake' },
            newValue: { stateKey: 'triage', note: 'All criteria met' },
            actorName: 'Jane Pharmacist',
            occurredAt: new Date('2026-08-18T10:00:00Z'),
          },
        ],
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      })

      const found = await service.get(actor, created.id)

      expect(auditQuery).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          recordType: 'pv_case',
          recordId: created.id,
          action: 'state_change',
        }),
      )
      expect(found.transitionHistory).toEqual([
        {
          fromStateKey: 'intake',
          toStateKey: 'triage',
          note: 'All criteria met',
          actorName: 'Jane Pharmacist',
          occurredAt: new Date('2026-08-18T10:00:00Z'),
        },
      ])
    })

    it('404s when an own-only actor requests a case they did not create', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      const otherViewer = new PvCaseService(
        {
          runAsCompany: (_c: string, fn: (tx: typeof harness.tables) => unknown) =>
            fn(harness.tables),
        } as never,
        { log: jest.fn().mockResolvedValue(undefined) } as never,
        { encrypt: jest.fn((s: string) => s), decrypt: jest.fn() } as never,
        { capture: jest.fn() } as never,
        { createVersion: jest.fn() } as never,
        { instantiate: jest.fn() } as never,
        {
          getPermissionsForUser: jest.fn().mockResolvedValue(new Set(['pv.capture_case'])),
        } as never,
        { evaluateInTx: jest.fn().mockResolvedValue({ allowed: true, criteria: [] }) } as never,
        { screenInTx: jest.fn().mockResolvedValue([]) } as never,
      )

      await expect(otherViewer.get(otherUserSameCompany, created.id)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('404s for a case belonging to another company', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})
      await expect(harness.service.get(otherCompanyActor, created.id)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws Forbidden for an actor with no PV permission at all', async () => {
      const harness = buildHarness([])
      await expect(harness.service.get(actor, 'case-1')).rejects.toThrow(ForbiddenException)
    })
  })

  describe('list()', () => {
    it('own-only actor sees only their own cases', async () => {
      const harness = buildHarness()
      const mine = await harness.service.create(actor, baseDto(), {})

      const otherCreator = new PvCaseService(
        {
          runAsCompany: (_c: string, fn: (tx: typeof harness.tables) => unknown) =>
            fn(harness.tables),
        } as never,
        { log: jest.fn().mockResolvedValue(undefined) } as never,
        { encrypt: jest.fn((s: string) => s), decrypt: jest.fn() } as never,
        { capture: jest.fn() } as never,
        { createVersion: jest.fn() } as never,
        { instantiate: jest.fn() } as never,
        {
          getPermissionsForUser: jest.fn().mockResolvedValue(new Set(['pv.capture_case'])),
        } as never,
        { evaluateInTx: jest.fn().mockResolvedValue({ allowed: true, criteria: [] }) } as never,
        { screenInTx: jest.fn().mockResolvedValue([]) } as never,
      )
      await otherCreator.create(otherUserSameCompany, baseDto(), {})

      const page = await harness.service.list(actor, { page: 1, limit: 25 })
      expect(page.data).toHaveLength(1)
      expect(page.data[0].id).toBe(mine.id)
    })

    it('view-all actor sees every case in the company', async () => {
      const harness = buildHarness()
      await harness.service.create(actor, baseDto(), {})

      const otherCreator = new PvCaseService(
        {
          runAsCompany: (_c: string, fn: (tx: typeof harness.tables) => unknown) =>
            fn(harness.tables),
        } as never,
        { log: jest.fn().mockResolvedValue(undefined) } as never,
        { encrypt: jest.fn((s: string) => s), decrypt: jest.fn() } as never,
        { capture: jest.fn() } as never,
        { createVersion: jest.fn() } as never,
        { instantiate: jest.fn() } as never,
        {
          getPermissionsForUser: jest.fn().mockResolvedValue(new Set(['pv.capture_case'])),
        } as never,
        { evaluateInTx: jest.fn().mockResolvedValue({ allowed: true, criteria: [] }) } as never,
        { screenInTx: jest.fn().mockResolvedValue([]) } as never,
      )
      await otherCreator.create(otherUserSameCompany, baseDto(), {})

      const viewer = new PvCaseService(
        {
          runAsCompany: (_c: string, fn: (tx: typeof harness.tables) => unknown) =>
            fn(harness.tables),
        } as never,
        { log: jest.fn().mockResolvedValue(undefined) } as never,
        { encrypt: jest.fn((s: string) => s), decrypt: jest.fn() } as never,
        { capture: jest.fn() } as never,
        { createVersion: jest.fn() } as never,
        { instantiate: jest.fn() } as never,
        { getPermissionsForUser: jest.fn().mockResolvedValue(new Set(['pv.view_all'])) } as never,
        { evaluateInTx: jest.fn().mockResolvedValue({ allowed: true, criteria: [] }) } as never,
        { screenInTx: jest.fn().mockResolvedValue([]) } as never,
      )

      const page = await viewer.list(actor, { page: 1, limit: 25 })
      expect(page.data).toHaveLength(2)
    })

    it('filters by search against the reference number, case-insensitively', async () => {
      const harness = buildHarness(['pv.view_all'])
      const created = await harness.service.create(actor, baseDto(), {})

      const page = await harness.service.list(actor, {
        page: 1,
        limit: 25,
        search: created.referenceNumber.toLowerCase(),
      })
      expect(page.data).toHaveLength(1)
      expect(page.data[0].id).toBe(created.id)
    })

    it('filters by requiresDraftReview', async () => {
      const harness = buildHarness(['pv.view_all'])
      await harness.service.create(actor, baseDto(), {})
      await harness.service.createFromSystemChannel('company-1', baseDto(), 'public_url', null, {})

      const drafts = await harness.service.list(actor, {
        page: 1,
        limit: 25,
        requiresDraftReview: true,
      })
      expect(drafts.data).toHaveLength(1)
      expect(drafts.data[0].requiresDraftReview).toBe(true)

      const confirmed = await harness.service.list(actor, {
        page: 1,
        limit: 25,
        requiresDraftReview: false,
      })
      expect(confirmed.data).toHaveLength(1)
      expect(confirmed.data[0].createdBy).toBe('user-1')
    })
  })

  describe('createFromSystemChannel()', () => {
    it('creates a case with no creator, flagged for draft review, using system-shaped consent/versioning/workflow calls', async () => {
      const { service, tables, auditLog, consentCaptureSystem, createVersion, instantiate } =
        buildHarness()

      const result = await service.createFromSystemChannel(
        'company-1',
        baseDto({ consent: { granted: true, method: 'implied' } }),
        'public_url',
        'wa-msg-123',
        { ip: '9.9.9.9' },
      )

      expect(result.createdBy).toBeNull()
      expect(result.requiresDraftReview).toBe(true)
      expect(result.channel).toBe('public_url')
      expect(result.sourceChannelReference).toBe('wa-msg-123')
      expect(tables.reporter.rows.size).toBe(1)
      expect(tables.suspectProduct.rows.size).toBe(2)

      expect(consentCaptureSystem).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({
          recordType: 'pv_case',
          recordId: result.id,
          granted: true,
          method: 'implied',
        }),
        { ip: '9.9.9.9' },
      )
      expect(createVersion).toHaveBeenCalledWith(
        { companyId: 'company-1' },
        expect.objectContaining({ recordType: 'pv_case', recordId: result.id }),
        { ip: '9.9.9.9' },
      )
      expect(instantiate).toHaveBeenCalledWith(
        { companyId: 'company-1' },
        'pv_case',
        result.id,
        'country-1',
        { ip: '9.9.9.9' },
      )
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'pv_case_created',
          actorType: 'system',
          recordId: result.id,
        }),
      )
    })

    it('never requires an actor at all — works with just a companyId', async () => {
      const { service } = buildHarness()
      await expect(
        service.createFromSystemChannel('company-1', baseDto(), 'drug_safety_email', null, {}),
      ).resolves.toBeDefined()
    })

    it("a system-created case is invisible to an own-only viewer (belongs to nobody's personal queue)", async () => {
      const harness = buildHarness()
      await harness.service.createFromSystemChannel('company-1', baseDto(), 'whatsapp_qr', null, {})

      const page = await harness.service.list(actor, { page: 1, limit: 25 })
      expect(page.data).toHaveLength(0)
    })

    it('a system-created case IS visible to a pv.view_all actor', async () => {
      const harness = buildHarness(['pv.view_all'])
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'whatsapp_qr',
        null,
        {},
      )

      const page = await harness.service.list(actor, { page: 1, limit: 25 })
      expect(page.data.map((c) => c.id)).toContain(created.id)
    })
  })

  describe('edit while at Intake (Stage 1 tasks 1.4/4.2)', () => {
    it('updateReporter() replaces the reporter fields and audits it', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      const updated = await harness.service.updateReporter(
        actor,
        created.id,
        {
          reporterType: 'consumer',
          fullName: 'Jane Fixed',
          email: undefined,
          phone: undefined,
          qualification: undefined,
          countryId: undefined,
          organization: undefined,
        },
        {},
      )

      expect(updated.fullName).toBe('Jane Fixed')
      expect(updated.reporterType).toBe('consumer')
      expect(harness.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_reporter_updated' }),
      )
    })

    it('updatePatient() replaces the patient fields, re-encrypting medical history', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      const updated = await harness.service.updatePatient(
        actor,
        created.id,
        { initials: 'A.B.', ageYears: 45, sex: 'female' },
        {},
      )

      expect(updated.initials).toBe('A.B.')
      expect(updated.ageYears).toBe(45)
    })

    it('addSuspectProduct() creates the row and pairs it with every existing adverse event', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})
      const existingCausalityCount = harness.tables.causalityAssessment.rows.size

      const product = await harness.service.addSuspectProduct(
        actor,
        created.id,
        { drugCharacterization: 'concomitant', medicinalProduct: 'Added Later' },
        {},
      )

      expect(product.medicinalProduct).toBe('Added Later')
      const newPairs = [...harness.tables.causalityAssessment.rows.values()].filter(
        (r) => r.suspectProductId === product.id,
      )
      expect(newPairs).toHaveLength(2) // baseDto() seeds exactly two adverse events
      expect(harness.tables.causalityAssessment.rows.size).toBe(existingCausalityCount + 2)
    })

    it('addAdverseEvent() creates the row, encrypts the narrative, and pairs it with every existing suspect product', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      const event = await harness.service.addAdverseEvent(
        actor,
        created.id,
        { reportedTerm: 'New reaction', narrative: 'Added later narrative' },
        {},
      )

      expect(event.reportedTerm).toBe('New reaction')
      expect(event.narrative).toBe('Added later narrative') // decrypted back on the way out
      const newPairs = [...harness.tables.causalityAssessment.rows.values()].filter(
        (r) => r.adverseEventId === event.id,
      )
      expect(newPairs).toHaveLength(2) // baseDto() seeds exactly two suspect products
    })

    it('rejects all four edits once the case has left Intake', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})
      harness.tables.case.rows.set(created.id, {
        ...harness.tables.case.rows.get(created.id)!,
        status: 'triage',
      })

      await expect(
        harness.service.updateReporter(actor, created.id, { reporterType: 'consumer' }, {}),
      ).rejects.toThrow(ForbiddenException)
      await expect(harness.service.updatePatient(actor, created.id, {}, {})).rejects.toThrow(
        ForbiddenException,
      )
      await expect(
        harness.service.addSuspectProduct(
          actor,
          created.id,
          { drugCharacterization: 'suspect', medicinalProduct: 'X' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
      await expect(
        harness.service.addAdverseEvent(
          actor,
          created.id,
          { reportedTerm: 'X', narrative: 'X' },
          {},
        ),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('confirmDraft()', () => {
    it('flips requiresDraftReview to false and audits it, once claimed by the confirming actor', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      expect(created.requiresDraftReview).toBe(true)

      await harness.service.claimDraft(actor, created.id, {})
      const confirmed = await harness.service.confirmDraft(actor, created.id, { ip: '1.1.1.1' })
      expect(confirmed.requiresDraftReview).toBe(false)
      expect(harness.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_draft_confirmed' }),
      )
    })

    it('is idempotent — confirming an already-confirmed case is a no-op, not an error', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      const result = await harness.service.confirmDraft(actor, created.id, {})
      expect(result.requiresDraftReview).toBe(false)
    })

    it('404s for a case that does not exist', async () => {
      const harness = buildHarness()
      await expect(harness.service.confirmDraft(actor, 'nope', {})).rejects.toThrow(
        NotFoundException,
      )
    })

    // Real-usage feedback, 19 Aug 2026 — "claim it and then work on
    // them... if not, then what's the use of claiming."
    it('rejects confirming an unclaimed draft-review case', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )

      await expect(harness.service.confirmDraft(actor, created.id, {})).rejects.toMatchObject({
        response: { code: 'MUST_CLAIM_FIRST' },
      })
    })

    it('rejects confirming a case claimed by someone else', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(otherUserSameCompany, created.id, {})

      await expect(harness.service.confirmDraft(actor, created.id, {})).rejects.toMatchObject({
        response: { code: 'MUST_CLAIM_FIRST' },
      })
    })
  })

  describe('rejectDraft() (real-usage request, 22 Sep 2026, item 13)', () => {
    it('flips requiresDraftReview to false, records the reason, clears the claim, and audits it', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(actor, created.id, {})

      const rejected = await harness.service.rejectDraft(
        actor,
        created.id,
        { reason: 'Duplicate submission of an already-confirmed report' },
        { ip: '1.1.1.1' },
      )
      expect(rejected.requiresDraftReview).toBe(false)
      expect(rejected.draftRejectionReason).toBe('Duplicate submission of an already-confirmed report')
      expect(rejected.draftRejectedAt).toBeInstanceOf(Date)
      expect(rejected.draftClaimedBy).toBeNull()
      expect(harness.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_draft_rejected' }),
      )
    })

    it('rejects rejecting a case that is not in the draft-review queue', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      await expect(
        harness.service.rejectDraft(actor, created.id, { reason: 'Not applicable' }, {}),
      ).rejects.toMatchObject({ response: { code: 'NOT_A_DRAFT' } })
    })

    it('requires a claim first, same as confirmDraft()', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )

      await expect(
        harness.service.rejectDraft(actor, created.id, { reason: 'Spam' }, {}),
      ).rejects.toMatchObject({ response: { code: 'MUST_CLAIM_FIRST' } })
    })

    it('rejects rejecting a case claimed by someone else', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(otherUserSameCompany, created.id, {})

      await expect(
        harness.service.rejectDraft(actor, created.id, { reason: 'Spam' }, {}),
      ).rejects.toMatchObject({ response: { code: 'MUST_CLAIM_FIRST' } })
    })

    it('404s for a case that does not exist', async () => {
      const harness = buildHarness()
      await expect(
        harness.service.rejectDraft(actor, 'nope', { reason: 'Spam' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('claimDraft() / releaseDraft()', () => {
    it('claims a draft-review case for the calling actor and audits it', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )

      const claimed = await harness.service.claimDraft(actor, created.id, {})
      expect(claimed.draftClaimedBy).toBe(actor.sub)
      expect(harness.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_draft_claimed' }),
      )
    })

    it('claiming the same case twice by the same actor is a no-op, not an error', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(actor, created.id, {})

      const claimedAgain = await harness.service.claimDraft(actor, created.id, {})
      expect(claimedAgain.draftClaimedBy).toBe(actor.sub)
    })

    it('rejects claiming a case someone else already claimed', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(otherUserSameCompany, created.id, {})

      await expect(harness.service.claimDraft(actor, created.id, {})).rejects.toMatchObject({
        response: { code: 'ALREADY_CLAIMED' },
      })
    })

    it('rejects claiming a case that is not in draft review at all', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})

      await expect(harness.service.claimDraft(actor, created.id, {})).rejects.toMatchObject({
        response: { code: 'NOT_A_DRAFT' },
      })
    })

    it('releases a claim so someone else can pick it up, and audits it', async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(actor, created.id, {})

      const released = await harness.service.releaseDraft(actor, created.id, {})
      expect(released.draftClaimedBy).toBeNull()
      expect(harness.auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_draft_released' }),
      )

      const reclaimed = await harness.service.claimDraft(otherUserSameCompany, created.id, {})
      expect(reclaimed.draftClaimedBy).toBe('user-2')
    })

    it("rejects releasing someone else's claim without pv.view_all", async () => {
      const harness = buildHarness()
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(otherUserSameCompany, created.id, {})

      await expect(harness.service.releaseDraft(actor, created.id, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it("allows a pv.view_all holder to release someone else's claim", async () => {
      const harness = buildHarness(['pv.capture_case', 'pv.view_all'])
      const created = await harness.service.createFromSystemChannel(
        'company-1',
        baseDto(),
        'public_url',
        null,
        {},
      )
      await harness.service.claimDraft(otherUserSameCompany, created.id, {})

      const released = await harness.service.releaseDraft(actor, created.id, {})
      expect(released.draftClaimedBy).toBeNull()
    })
  })

  describe('special-situation fields', () => {
    it('carries suspectedFalsifiedOrSubstandard through to the created case', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(
        actor,
        baseDto({ suspectedFalsifiedOrSubstandard: true }),
        {},
      )
      expect(created.suspectedFalsifiedOrSubstandard).toBe(true)
    })

    it('creates a PregnancyContext when the dto includes one, computing followUpDueAt from the expected delivery date', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(
        actor,
        baseDto({
          pregnancy: {
            expectedDeliveryDate: '2026-12-01',
            gestationWeeksAtExposure: 12,
            outcome: 'ongoing',
          },
        }),
        {},
      )

      expect(created.pregnancyContext).not.toBeNull()
      expect(created.pregnancyContext!.gestationWeeksAtExposure).toBe(12)
      expect(created.pregnancyContext!.outcome).toBe('ongoing')
      // 8 weeks after the expected delivery date (2026-12-01 -> 2027-01-26).
      const followUp = created.pregnancyContext!.followUpDueAt as Date
      expect(followUp.toISOString().slice(0, 10)).toBe('2027-01-26')
    })

    it('does not create a PregnancyContext when the dto omits pregnancy', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(actor, baseDto(), {})
      expect(created.pregnancyContext).toBeNull()
    })

    it('carries the per-suspect-product special-situation flags through', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(
        actor,
        baseDto({
          suspectProducts: [
            {
              drugCharacterization: 'suspect',
              medicinalProduct: 'Panadol',
              isOverdose: true,
              isOffLabelUse: true,
              isMisuse: false,
              isMedicationError: true,
            },
          ],
        }),
        {},
      )

      const [product] = created.suspectProducts
      expect(product.isOverdose).toBe(true)
      expect(product.isOffLabelUse).toBe(true)
      expect(product.isMisuse).toBe(false)
      expect(product.isMedicationError).toBe(true)
    })

    it('carries isLackOfEfficacy through on adverse events', async () => {
      const harness = buildHarness()
      const created = await harness.service.create(
        actor,
        baseDto({
          adverseEvents: [
            {
              reportedTerm: 'No improvement',
              narrative: 'Drug had no effect',
              isLackOfEfficacy: true,
            },
          ],
        }),
        {},
      )

      expect(created.adverseEvents[0].isLackOfEfficacy).toBe(true)
    })
  })
})
