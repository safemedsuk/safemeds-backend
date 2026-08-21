import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { deriveSeriousnessClass, TriageService } from './triage.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

const NO_FLAGS = {
  seriousnessDeath: false,
  seriousnessLifeThreatening: false,
  seriousnessHospitalization: false,
  seriousnessDisabling: false,
  seriousnessCongenitalAnomaly: false,
  seriousnessOther: false,
}

describe('deriveSeriousnessClass() — pure function', () => {
  it('is non_serious when no event has any seriousness flag', () => {
    expect(deriveSeriousnessClass([{ ...NO_FLAGS }], 'adr')).toBe('non_serious')
  })

  it('is serious when any single flag (other than death) is set', () => {
    expect(deriveSeriousnessClass([{ ...NO_FLAGS, seriousnessHospitalization: true }], 'adr')).toBe(
      'serious',
    )
  })

  it('is fatal for an ADR case with a death flag (the three-tier report type)', () => {
    expect(deriveSeriousnessClass([{ ...NO_FLAGS, seriousnessDeath: true }], 'adr')).toBe('fatal')
  })

  it('is serious, not fatal, for a non-ADR report type even with a death flag (only two tiers exist)', () => {
    expect(
      deriveSeriousnessClass([{ ...NO_FLAGS, seriousnessDeath: true }], 'device_incident'),
    ).toBe('serious')
  })

  it('takes the worst classification across multiple events, not just the first', () => {
    const events = [
      { ...NO_FLAGS },
      { ...NO_FLAGS, seriousnessDeath: true },
      { ...NO_FLAGS, seriousnessHospitalization: true },
    ]
    expect(deriveSeriousnessClass(events, 'adr')).toBe('fatal')
  })

  it('is non_serious for an empty event list', () => {
    expect(deriveSeriousnessClass([], 'adr')).toBe('non_serious')
  })
})

function buildHarness() {
  const pvCase = {
    id: 'case-1',
    companyId: 'company-1',
    countryOfReportId: 'country-1',
    reportTypeId: 'report-type-adr',
    awarenessDate: new Date('2026-08-01'),
    seriousnessClass: null as string | null,
    reportType: { id: 'report-type-adr', typeKey: 'adr' },
    adverseEvents: [{ ...NO_FLAGS, seriousnessHospitalization: true }],
  }

  const authority = { id: 'authority-ppb', countryId: 'country-1', code: 'PPB' }

  const caseFindFirst = jest.fn().mockResolvedValue(pvCase)
  const caseUpdate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...pvCase, ...data }))
  const deadlineFindUnique = jest.fn().mockResolvedValue(null)
  const authorityFindMany = jest.fn().mockResolvedValue([authority])
  const reportingRuleFindFirst = jest.fn().mockResolvedValue({ id: 'rule-1' })

  const tables = {
    case: { findFirst: caseFindFirst, update: caseUpdate },
    deadline: { findUnique: deadlineFindUnique },
    regulatoryAuthority: { findMany: authorityFindMany },
    reportingRule: { findFirst: reportingRuleFindFirst },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const computeFor = jest
    .fn()
    .mockResolvedValue({ id: 'deadline-1', dueAt: new Date('2026-08-16') })
  const recompute = jest.fn().mockResolvedValue({ id: 'deadline-1', dueAt: new Date('2026-08-31') })
  const deadlineService = { computeFor, recompute } as never

  const service = new TriageService(rls as never, auditService, deadlineService)
  return {
    service,
    tables,
    auditLog,
    computeFor,
    recompute,
    caseUpdate,
    authorityFindMany,
    reportingRuleFindFirst,
    deadlineFindUnique,
    pvCase,
  }
}

describe('TriageService', () => {
  describe('classify()', () => {
    it("auto-derives seriousness from the case's own adverse events when no override is given", async () => {
      const { service, caseUpdate } = buildHarness()
      const result = await service.classify(actor, 'case-1', {}, {})

      expect(caseUpdate).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { seriousnessClass: 'serious' },
      })
      expect(result.case.seriousnessClass).toBe('serious')
    })

    it('accepts an explicit override instead of the derived value', async () => {
      const { service, caseUpdate } = buildHarness()
      await service.classify(actor, 'case-1', { seriousnessClass: 'fatal' }, {})
      expect(caseUpdate).toHaveBeenCalledWith({
        where: { id: 'case-1' },
        data: { seriousnessClass: 'fatal' },
      })
    })

    it('computes a new deadline via DeadlineService.computeFor() when none exists yet', async () => {
      const { service, computeFor, recompute } = buildHarness()
      const result = await service.classify(actor, 'case-1', {}, { ip: '1.1.1.1' })

      expect(computeFor).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          companyId: 'company-1',
          recordType: 'pv_case',
          recordId: 'case-1',
          authorityId: 'authority-ppb',
          seriousnessClass: 'serious',
        }),
        { ip: '1.1.1.1' },
      )
      expect(recompute).not.toHaveBeenCalled()
      expect(result.deadline).toEqual({ id: 'deadline-1', dueAt: new Date('2026-08-16') })
      expect(result.deadlineUnavailable).toBe(false)
    })

    it('recomputes the existing deadline instead of creating a second one when a deadline already exists', async () => {
      const { service, deadlineFindUnique, computeFor, recompute } = buildHarness()
      deadlineFindUnique.mockResolvedValue({ id: 'deadline-1' })

      await service.classify(actor, 'case-1', {}, {})

      expect(recompute).toHaveBeenCalledWith(actor, 'deadline-1', 'serious', expect.any(Date), {})
      expect(computeFor).not.toHaveBeenCalled()
    })

    it('resolves the authority by which one has an active rule for this report type, not just any authority in the country', async () => {
      const { service, authorityFindMany, reportingRuleFindFirst, computeFor } = buildHarness()
      const nvip = { id: 'authority-nvip', countryId: 'country-1', code: 'NVIP' }
      const ppb = { id: 'authority-ppb', countryId: 'country-1', code: 'PPB' }
      authorityFindMany.mockResolvedValue([nvip, ppb])
      reportingRuleFindFirst.mockImplementation(({ where }: { where: { authorityId: string } }) =>
        Promise.resolve(where.authorityId === 'authority-ppb' ? { id: 'rule-1' } : null),
      )

      await service.classify(actor, 'case-1', {}, {})

      expect(computeFor).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ authorityId: 'authority-ppb' }),
        {},
      )
    })

    it('classifies successfully but leaves the deadline null when no active rule resolves for any authority (e.g. an unverified-only report type)', async () => {
      const { service, computeFor, authorityFindMany } = buildHarness()
      authorityFindMany.mockResolvedValue([])

      const result = await service.classify(actor, 'case-1', {}, {})

      expect(computeFor).not.toHaveBeenCalled()
      expect(result.deadline).toBeNull()
      expect(result.deadlineUnavailable).toBe(true)
      expect(result.case.seriousnessClass).toBe('serious')
    })

    it('classifies successfully but leaves the deadline null when DeadlineService throws NO_ACTIVE_RULE', async () => {
      const { service, computeFor } = buildHarness()
      computeFor.mockRejectedValue(
        new NotFoundException({
          code: 'NO_ACTIVE_RULE',
          message: 'No active reporting rule resolves',
        }),
      )

      const result = await service.classify(actor, 'case-1', {}, {})

      expect(result.deadline).toBeNull()
      expect(result.deadlineUnavailable).toBe(true)
    })

    it('classifies successfully but leaves the deadline null when DeadlineService throws RULE_UNVERIFIED', async () => {
      const { service, computeFor } = buildHarness()
      computeFor.mockRejectedValue(
        new ConflictException({
          code: 'RULE_UNVERIFIED',
          message: 'The resolved reporting rule is unverified',
        }),
      )

      const result = await service.classify(actor, 'case-1', {}, {})

      expect(result.deadline).toBeNull()
      expect(result.deadlineUnavailable).toBe(true)
    })

    it('re-throws an unrelated error from DeadlineService rather than silently swallowing it', async () => {
      const { service, computeFor } = buildHarness()
      computeFor.mockRejectedValue(new Error('a genuinely unexpected failure'))

      await expect(service.classify(actor, 'case-1', {}, {})).rejects.toThrow(
        'a genuinely unexpected failure',
      )
    })

    it('audits the classification with old and new seriousness values', async () => {
      const { service, auditLog } = buildHarness()
      await service.classify(actor, 'case-1', {}, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'pv_case_triaged',
          oldValue: { seriousnessClass: null },
          newValue: expect.objectContaining({ seriousnessClass: 'serious' }),
        }),
      )
    })

    it('404s for a case that does not exist in this company', async () => {
      const { service, tables } = buildHarness()
      tables.case.findFirst.mockResolvedValue(null)
      await expect(service.classify(actor, 'missing-case', {}, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(service.classify(platformActor, 'case-1', {}, {})).rejects.toThrow(
        ForbiddenException,
      )
    })
  })
})
