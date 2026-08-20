import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DuplicateDetectionService, findSimilarityMatch } from './duplicate-detection.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

const KE = 'country-ke'
const TZ = 'country-tz'

describe('findSimilarityMatch() — pure function', () => {
  const base = {
    id: 'target',
    countryOfOccurrenceId: KE,
    awarenessDate: new Date('2026-08-01'),
    patient: { sex: 'female' as const, ageYears: 30, dateOfBirth: null },
    productTerms: ['Depo-Provera', 'MEDROXYPROGESTERONE ACETATE'],
    reactionTerms: ['Headache'],
  }

  it('matches when country/sex/age all align and both a product and a reaction term overlap', () => {
    const candidate = {
      ...base,
      id: 'candidate',
      productTerms: ['depo-provera 150mg injection'],
      reactionTerms: ['headache, severe'],
    }
    const match = findSimilarityMatch(base, candidate)
    expect(match).not.toBeNull()
    expect(match!.matchedCaseId).toBe('candidate')
    expect(match!.matchedFields.products).toContain('Depo-Provera')
    expect(match!.matchedFields.reactions).toContain('Headache')
  })

  it('returns null when countries differ — the guideline\'s "strong initial filter"', () => {
    const candidate = { ...base, id: 'candidate', countryOfOccurrenceId: TZ }
    expect(findSimilarityMatch(base, candidate)).toBeNull()
  })

  it('returns null when sex is known and differs on both sides', () => {
    const candidate = {
      ...base,
      id: 'candidate',
      patient: { sex: 'male' as const, ageYears: 30, dateOfBirth: null },
    }
    expect(findSimilarityMatch(base, candidate)).toBeNull()
  })

  it('does not filter on sex when either side is "unknown"', () => {
    const candidate = {
      ...base,
      id: 'candidate',
      patient: { sex: 'unknown' as const, ageYears: 30, dateOfBirth: null },
    }
    expect(findSimilarityMatch(base, candidate)).not.toBeNull()
  })

  it('tolerates a small age spread but not a large one', () => {
    const closeAge = {
      ...base,
      id: 'close',
      patient: { sex: 'female' as const, ageYears: 32, dateOfBirth: null },
    }
    const farAge = {
      ...base,
      id: 'far',
      patient: { sex: 'female' as const, ageYears: 40, dateOfBirth: null },
    }
    expect(findSimilarityMatch(base, closeAge)).not.toBeNull()
    expect(findSimilarityMatch(base, farAge)).toBeNull()
  })

  it('requires BOTH a product AND a reaction overlap — neither alone is enough', () => {
    const productOnly = {
      ...base,
      id: 'p',
      productTerms: ['Depo-Provera'],
      reactionTerms: ['Completely different reaction'],
    }
    const reactionOnly = {
      ...base,
      id: 'r',
      productTerms: ['Some other drug entirely'],
      reactionTerms: ['Headache'],
    }
    expect(findSimilarityMatch(base, productOnly)).toBeNull()
    expect(findSimilarityMatch(base, reactionOnly)).toBeNull()
  })

  it('matches reaction terms with the same significant words in a different order — a clinician\'s "Headache, severe" is the same reaction as a patient\'s own "Severe headache"', () => {
    const reordered = {
      ...base,
      id: 'reordered',
      productTerms: ['Depo-Provera'],
      reactionTerms: ['Headache, severe'],
    }
    expect(findSimilarityMatch(base, reordered)).not.toBeNull()
  })

  it('does not match on short, generic word fragments alone (e.g. dosage units)', () => {
    const candidate = {
      ...base,
      id: 'candidate',
      productTerms: ['Panadol 500mg'],
      reactionTerms: ['Nausea'],
    }
    expect(findSimilarityMatch(base, candidate)).toBeNull()
  })
})

// ── Service-level tests — a minimal in-memory relational mock, following
// the same shape as `pv-case.service.spec.ts`'s own `createTable()`.
interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>() {
  const rows = new Map<string, T>()

  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (key === 'OR') {
        return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
      }
      if (
        key === 'id' &&
        value !== null &&
        typeof value === 'object' &&
        'not' in (value as Record<string, unknown>)
      ) {
        return row.id !== (value as { not: string }).not
      }
      return row[key] === value
    })
  }

  function createImpl({ data }: { data: T }): Promise<T> {
    const row = { ...data }
    rows.set(row.id, row)
    return Promise.resolve(row)
  }
  function findFirstImpl({ where }: { where: Record<string, unknown> }): Promise<T | null> {
    return Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null)
  }
  async function findFirstOrThrowImpl(args: { where: Record<string, unknown> }): Promise<T> {
    const found = await findFirstImpl(args)
    if (!found) throw new Error('not found')
    return found
  }
  function findManyImpl({ where }: { where?: Record<string, unknown> }): Promise<T[]> {
    return Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})))
  }
  function updateImpl({ where, data }: { where: { id: string }; data: Partial<T> }): Promise<T> {
    const existing = rows.get(where.id)!
    const updated = { ...existing, ...data }
    rows.set(where.id, updated)
    return Promise.resolve(updated)
  }

  const create = jest.fn(createImpl)
  const findFirst = jest.fn(findFirstImpl)
  const findFirstOrThrow = jest.fn(findFirstOrThrowImpl)
  const findMany = jest.fn(findManyImpl)
  const update = jest.fn(updateImpl)

  return { rows, create, findFirst, findFirstOrThrow, findMany, update }
}

function buildHarness() {
  const tables = {
    case: createTable(),
    patient: createTable(),
    reporter: createTable(),
    suspectProduct: createTable(),
    adverseEvent: createTable(),
    causalityAssessment: createTable(),
    duplicateReview: createTable(),
  }

  // Hydrate `include` relations for `case.findMany`/`findFirst`/`findFirstOrThrow`, mirroring `pv-case.service.spec.ts`'s own precedent.
  function hydrate(found: Row): Row {
    return {
      ...found,
      patient: [...tables.patient.rows.values()].find((r) => r.caseId === found.id) ?? null,
      reporter: [...tables.reporter.rows.values()].find((r) => r.caseId === found.id) ?? null,
      suspectProducts: [...tables.suspectProduct.rows.values()].filter(
        (r) => r.caseId === found.id,
      ),
      adverseEvents: [...tables.adverseEvent.rows.values()].filter((r) => r.caseId === found.id),
    }
  }
  const baseCaseFindFirst = tables.case.findFirst
  async function caseFindFirstImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row | null> {
    const found = await baseCaseFindFirst(args)
    return found && args.include ? hydrate(found) : found
  }
  tables.case.findFirst = jest.fn(caseFindFirstImpl) as never

  const baseCaseFindFirstOrThrow = tables.case.findFirstOrThrow
  async function caseFindFirstOrThrowImpl(args: {
    where: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row> {
    const found = await baseCaseFindFirstOrThrow(args)
    return args.include ? hydrate(found) : found
  }
  tables.case.findFirstOrThrow = jest.fn(caseFindFirstOrThrowImpl) as never

  const baseCaseFindMany = tables.case.findMany
  async function caseFindManyImpl(args: {
    where?: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row[]> {
    const found = await baseCaseFindMany(args)
    return args.include ? found.map(hydrate) : found
  }
  tables.case.findMany = jest.fn(caseFindManyImpl) as never

  const baseDuplicateReviewFindMany = tables.duplicateReview.findMany
  async function duplicateReviewFindManyImpl(args: {
    where?: Record<string, unknown>
    include?: Record<string, boolean>
  }): Promise<Row[]> {
    const found = await baseDuplicateReviewFindMany(args)
    if (!args.include) return found
    return found.map((r) => ({
      ...r,
      case: [...tables.case.rows.values()].find((c) => c.id === r.caseId) ?? null,
      matchedCase: [...tables.case.rows.values()].find((c) => c.id === r.matchedCaseId) ?? null,
    }))
  }
  tables.duplicateReview.findMany = jest.fn(duplicateReviewFindManyImpl) as never

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: unknown) => unknown) => fn({}),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const textEncryption = {
    encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decrypt: jest.fn((ciphertext: string) => ciphertext.replace(/^enc\(/, '').replace(/\)$/, '')),
  } as never
  const createVersion = jest.fn().mockResolvedValue({ id: 'version-1' })
  const recordVersioningService = { createVersion } as never
  const instantiate = jest.fn().mockResolvedValue({ id: 'workflow-instance-1' })
  const workflowService = { instantiate } as never

  const service = new DuplicateDetectionService(
    rls as never,
    auditService,
    textEncryption,
    recordVersioningService,
    workflowService,
  )
  return { service, tables, auditLog, instantiate, createVersion }
}

function seedCase(
  tables: ReturnType<typeof buildHarness>['tables'],
  overrides: Record<string, unknown> = {},
) {
  const id = (overrides.id as string) ?? `case-${tables.case.rows.size + 1}`
  const row = {
    id,
    companyId: 'company-1',
    referenceNumber: `PV-2026-${id}`,
    countryOfOccurrenceId: KE,
    countryOfReportId: KE,
    reportTypeId: 'report-type-1',
    channel: 'form',
    awarenessDate: new Date('2026-08-01'),
    receivedDate: new Date('2026-08-01'),
    duplicateOfCaseId: null,
    additionalInformationEncrypted: null,
    ...overrides,
  }
  tables.case.rows.set(id, row)
  tables.patient.rows.set(`patient-${id}`, {
    id: `patient-${id}`,
    caseId: id,
    companyId: 'company-1',
    sex: 'female',
    ageYears: 30,
    dateOfBirth: null,
    initials: 'A.B.',
    weightKg: null,
    heightCm: null,
    medicalHistoryEncrypted: null,
  })
  tables.suspectProduct.rows.set(`sp-${id}`, {
    id: `sp-${id}`,
    caseId: id,
    companyId: 'company-1',
    medicinalProduct: 'Depo-Provera',
    activeSubstanceName: null,
    drugCharacterization: 'suspect',
    atcCode: null,
    dosageForm: null,
    route: null,
    doseText: null,
    batchNumber: null,
    startDate: null,
    endDate: null,
    actionTaken: null,
    obtainedCountryId: null,
    productId: null,
    isOverdose: false,
    isOffLabelUse: false,
    isMisuse: false,
    isMedicationError: false,
    whoDrugTermId: null,
  })
  tables.adverseEvent.rows.set(`ae-${id}`, {
    id: `ae-${id}`,
    caseId: id,
    companyId: 'company-1',
    reportedTerm: 'Headache',
    narrativeEncrypted: 'enc(narrative)',
    meddraTermId: null,
    onsetDate: null,
    resolutionDate: null,
    outcome: 'unknown',
    seriousnessDeath: false,
    seriousnessLifeThreatening: false,
    seriousnessHospitalization: false,
    seriousnessDisabling: false,
    seriousnessCongenitalAnomaly: false,
    seriousnessOther: false,
    isLackOfEfficacy: false,
  })
  tables.reporter.rows.set(`reporter-${id}`, {
    id: `reporter-${id}`,
    caseId: id,
    companyId: 'company-1',
    reporterType: 'consumer',
    fullName: 'A Reporter',
    email: null,
    phone: null,
    qualification: null,
    countryId: null,
    organization: null,
  })
  return row
}

describe('DuplicateDetectionService', () => {
  describe('screenInTx()', () => {
    it('detects a fuzzy match against an existing open case and creates a possible review', async () => {
      const { service, tables } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      const target = seedCase(tables, { id: 'case-2' })

      const touched = await service.screenInTx(tables as never, 'company-1', target.id)
      expect(touched).toHaveLength(1)
      expect(touched[0].status).toBe('possible')
      expect([touched[0].caseId, touched[0].matchedCaseId].sort()).toEqual(['case-1', 'case-2'])
    })

    it('short-circuits to the cited reference number, skipping the fuzzy filter entirely', async () => {
      const { service, tables } = buildHarness()
      const cited = seedCase(tables, {
        id: 'case-1',
        referenceNumber: 'PV-2026-99999',
        countryOfOccurrenceId: TZ,
      }) // deliberately non-matching country
      const target = seedCase(tables, { id: 'case-2' })

      const touched = await service.screenInTx(
        tables as never,
        'company-1',
        target.id,
        cited.referenceNumber,
      )
      expect(touched).toHaveLength(1)
      expect(touched[0].matchedFields).toEqual({ citedReferenceNumber: true })
    })

    it('does not create a duplicate review row when re-screened from the other direction', async () => {
      const { service, tables } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      seedCase(tables, { id: 'case-2' })

      await service.screenInTx(tables as never, 'company-1', 'case-2')
      const afterFirst = tables.duplicateReview.rows.size
      await service.screenInTx(tables as never, 'company-1', 'case-1')

      expect(tables.duplicateReview.rows.size).toBe(afterFirst)
    })

    it('excludes cases that already have a master (duplicateOfCaseId set) from candidacy', async () => {
      const { service, tables } = buildHarness()
      seedCase(tables, { id: 'case-1', duplicateOfCaseId: 'some-master' })
      const target = seedCase(tables, { id: 'case-2' })

      const touched = await service.screenInTx(tables as never, 'company-1', target.id)
      expect(touched).toHaveLength(0)
    })
  })

  describe('confirmDuplicate()', () => {
    it('allocation: marks the non-master case as a subordinate, leaves the master untouched', async () => {
      const { service, tables, auditLog } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      seedCase(tables, { id: 'case-2' })
      tables.duplicateReview.rows.set('review-1', {
        id: 'review-1',
        companyId: 'company-1',
        caseId: 'case-1',
        matchedCaseId: 'case-2',
        status: 'possible',
        matchedFields: {},
        detectedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNoteEncrypted: null,
        resolutionPattern: null,
      })

      const result = await service.confirmDuplicate(
        actor,
        'review-1',
        { resolutionPattern: 'allocation', masterCaseId: 'case-1' },
        {},
      )

      expect(result.masterCaseId).toBe('case-1')
      expect((tables.case.rows.get('case-2') as Row).duplicateOfCaseId).toBe('case-1')
      expect((tables.case.rows.get('case-1') as Row).duplicateOfCaseId).toBeNull()
      expect(result.review.status).toBe('confirmed_duplicate')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_duplicate_confirmed' }),
      )
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_case_marked_duplicate', recordId: 'case-2' }),
      )
    })

    it('allocation: rejects a masterCaseId that is neither case in the pair', async () => {
      const { service, tables } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      seedCase(tables, { id: 'case-2' })
      tables.duplicateReview.rows.set('review-1', {
        id: 'review-1',
        companyId: 'company-1',
        caseId: 'case-1',
        matchedCaseId: 'case-2',
        status: 'possible',
        matchedFields: {},
      })

      await expect(
        service.confirmDuplicate(
          actor,
          'review-1',
          { resolutionPattern: 'allocation', masterCaseId: 'not-in-pair' },
          {},
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('creation: synthesizes a brand-new master case and marks both originals as subordinates', async () => {
      const { service, tables, instantiate, createVersion } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      seedCase(tables, { id: 'case-2' })
      tables.duplicateReview.rows.set('review-1', {
        id: 'review-1',
        companyId: 'company-1',
        caseId: 'case-1',
        matchedCaseId: 'case-2',
        status: 'possible',
        matchedFields: {},
      })

      const result = await service.confirmDuplicate(
        actor,
        'review-1',
        { resolutionPattern: 'creation' },
        {},
      )

      expect(result.masterCaseId).not.toBe('case-1')
      expect(result.masterCaseId).not.toBe('case-2')
      expect((tables.case.rows.get('case-1') as Row).duplicateOfCaseId).toBe(result.masterCaseId)
      expect((tables.case.rows.get('case-2') as Row).duplicateOfCaseId).toBe(result.masterCaseId)

      const masterProducts = [...tables.suspectProduct.rows.values()].filter(
        (r) => r.caseId === result.masterCaseId,
      )
      const masterEvents = [...tables.adverseEvent.rows.values()].filter(
        (r) => r.caseId === result.masterCaseId,
      )
      expect(masterProducts).toHaveLength(2) // one from each subordinate
      expect(masterEvents).toHaveLength(2)
      const masterCausality = [...tables.causalityAssessment.rows.values()].filter(
        (r) => r.caseId === result.masterCaseId,
      )
      expect(masterCausality).toHaveLength(4) // 2 products × 2 events

      expect(instantiate).toHaveBeenCalled()
      expect(createVersion).toHaveBeenCalled()
    })

    it('rejects confirming a review that has already been reviewed', async () => {
      const { service, tables } = buildHarness()
      tables.duplicateReview.rows.set('review-1', {
        id: 'review-1',
        companyId: 'company-1',
        caseId: 'case-1',
        matchedCaseId: 'case-2',
        status: 'not_duplicate',
        matchedFields: {},
      })

      await expect(
        service.confirmDuplicate(
          actor,
          'review-1',
          { resolutionPattern: 'allocation', masterCaseId: 'case-1' },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })

    it('404s for a review that does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.confirmDuplicate(
          actor,
          'missing',
          { resolutionPattern: 'allocation', masterCaseId: 'case-1' },
          {},
        ),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('dismissDuplicate()', () => {
    it('marks the review not_duplicate and stores the (encrypted) reason, touching neither case', async () => {
      const { service, tables } = buildHarness()
      seedCase(tables, { id: 'case-1' })
      seedCase(tables, { id: 'case-2' })
      tables.duplicateReview.rows.set('review-1', {
        id: 'review-1',
        companyId: 'company-1',
        caseId: 'case-1',
        matchedCaseId: 'case-2',
        status: 'possible',
        matchedFields: {},
      })

      const result = await service.dismissDuplicate(
        actor,
        'review-1',
        { reviewNote: 'Different patients, coincidental overlap' },
        {},
      )

      expect(result.status).toBe('not_duplicate')
      expect(result.reviewNote).toBe('Different patients, coincidental overlap')
      expect((tables.case.rows.get('case-1') as Row).duplicateOfCaseId).toBeNull()
      expect((tables.case.rows.get('case-2') as Row).duplicateOfCaseId).toBeNull()
    })
  })
})
