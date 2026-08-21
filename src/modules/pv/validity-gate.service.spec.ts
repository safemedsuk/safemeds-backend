import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ValidityGateService } from './validity-gate.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const reporterFindFirst = jest.fn()
  const patientFindFirst = jest.fn()
  const suspectProductCount = jest.fn().mockResolvedValue(1)
  const adverseEventCount = jest.fn().mockResolvedValue(1)

  const tables = {
    reporter: { findFirst: reporterFindFirst },
    patient: { findFirst: patientFindFirst },
    suspectProduct: { count: suspectProductCount },
    adverseEvent: { count: adverseEventCount },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new ValidityGateService(rls as never)
  return {
    service,
    tables,
    reporterFindFirst,
    patientFindFirst,
    suspectProductCount,
    adverseEventCount,
  }
}

describe('ValidityGateService', () => {
  describe('evaluate() / evaluateInTx()', () => {
    it('is allowed when all four criteria are met', async () => {
      const { service, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue({
        fullName: 'Jane Doe',
        email: null,
        phone: null,
        organization: null,
      })
      patientFindFirst.mockResolvedValue({
        initials: 'J.D.',
        dateOfBirth: null,
        ageYears: null,
        sex: 'unknown',
      })

      const result = await service.evaluate(actor, 'case-1')

      expect(result.allowed).toBe(true)
      expect(result.criteria.every((c) => c.met)).toBe(true)
    })

    it('is not allowed, and names the reporter, when the reporter has zero identifying fields', async () => {
      const { service, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue({
        fullName: null,
        email: null,
        phone: null,
        organization: null,
      })
      patientFindFirst.mockResolvedValue({
        initials: 'J.D.',
        dateOfBirth: null,
        ageYears: null,
        sex: 'unknown',
      })

      const result = await service.evaluate(actor, 'case-1')

      expect(result.allowed).toBe(false)
      const reporterCriterion = result.criteria.find((c) => c.key === 'identifiable_reporter')!
      expect(reporterCriterion.met).toBe(false)
    })

    it('is not allowed when there is no reporter row at all', async () => {
      const { service, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue(null)
      patientFindFirst.mockResolvedValue({ initials: 'J.D.' })

      const result = await service.evaluate(actor, 'case-1')
      expect(result.criteria.find((c) => c.key === 'identifiable_reporter')!.met).toBe(false)
    })

    it('treats an age of 0 as identifying (falsy-but-valid — must not be dropped by a naive truthy check)', async () => {
      const { service, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue({ fullName: 'Jane Doe' })
      patientFindFirst.mockResolvedValue({
        initials: null,
        dateOfBirth: null,
        ageYears: 0,
        sex: 'unknown',
      })

      const result = await service.evaluate(actor, 'case-1')
      expect(result.criteria.find((c) => c.key === 'identifiable_patient')!.met).toBe(true)
    })

    it('treats an unspecified/"unknown" sex with no other patient field as not identifying', async () => {
      const { service, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue({ fullName: 'Jane Doe' })
      patientFindFirst.mockResolvedValue({
        initials: null,
        dateOfBirth: null,
        ageYears: null,
        sex: 'unknown',
      })

      const result = await service.evaluate(actor, 'case-1')
      expect(result.criteria.find((c) => c.key === 'identifiable_patient')!.met).toBe(false)
    })

    it('is not allowed with zero suspect products or zero adverse events', async () => {
      const {
        service,
        reporterFindFirst,
        patientFindFirst,
        suspectProductCount,
        adverseEventCount,
      } = buildHarness()
      reporterFindFirst.mockResolvedValue({ fullName: 'Jane Doe' })
      patientFindFirst.mockResolvedValue({ initials: 'J.D.' })
      suspectProductCount.mockResolvedValue(0)
      adverseEventCount.mockResolvedValue(0)

      const result = await service.evaluate(actor, 'case-1')

      expect(result.allowed).toBe(false)
      expect(result.criteria.find((c) => c.key === 'suspect_product')!.met).toBe(false)
      expect(result.criteria.find((c) => c.key === 'adverse_event')!.met).toBe(false)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(service.evaluate(platformActor, 'case-1')).rejects.toThrow(ForbiddenException)
    })

    it('evaluateInTx() works against an already-open transaction with no extra RLS wrapping', async () => {
      const { service, tables, reporterFindFirst, patientFindFirst } = buildHarness()
      reporterFindFirst.mockResolvedValue({ fullName: 'Jane Doe' })
      patientFindFirst.mockResolvedValue({ initials: 'J.D.' })

      const result = await service.evaluateInTx(tables as never, 'case-1')
      expect(result.allowed).toBe(true)
    })
  })
})
