import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import {
  CausalityService,
  computeNaranjoScore,
  interpretNaranjoScore,
  NaranjoInterpretation,
} from './causality.service'
import { NaranjoAnswersDto } from './dto/assess-causality.dto'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function allNo(overrides: Partial<NaranjoAnswersDto> = {}): NaranjoAnswersDto {
  return {
    q1: 'no',
    q2: 'no',
    q3: 'no',
    q4: 'no',
    q5: 'no',
    q6: 'no',
    q7: 'no',
    q8: 'no',
    q9: 'no',
    q10: 'no',
    ...overrides,
  }
}

describe('computeNaranjoScore() — pure function', () => {
  it('is 1 for an all-"no" baseline — q2/q4 penalize a "no" (-1 each), q5/q6 reward it (+2/+1)', () => {
    // q1=0, q2=-1, q3=0, q4=-1, q5=+2, q6=+1, q7..q10=0 → 0-1+0-1+2+1 = 1
    expect(computeNaranjoScore(allNo())).toBe(1)
  })

  it('scores a textbook strong case correctly, including the two inverted questions', () => {
    // Previous conclusive reports (q1 yes=+1), reaction after drug (q2 yes=+2),
    // improved on withdrawal (q3 yes=+1), reappeared on rechallenge (q4 yes=+2),
    // NO alternative cause (q5 no=+2, the inverted one), no placebo reappearance
    // (q6 no=+1, also inverted), objective confirmation (q10 yes=+1).
    // Total = 1+2+1+2+2+1+1 = 10 → crosses into "definite."
    const answers = allNo({ q1: 'yes', q2: 'yes', q3: 'yes', q4: 'yes', q10: 'yes' })
    expect(computeNaranjoScore(answers)).toBe(1 + 2 + 1 + 2 + 2 + 1 + 1)
    expect(interpretNaranjoScore(computeNaranjoScore(answers))).toBe('definite')
  })

  it('question 5 ("alternative cause") is inverted — answering "yes" (an alternative exists) SUBTRACTS a point, not adds one', () => {
    const withAlternative = allNo({ q5: 'yes' })
    const withoutAlternative = allNo({ q5: 'no' })
    expect(computeNaranjoScore(withAlternative)).toBe(computeNaranjoScore(withoutAlternative) - 3)
  })

  it('question 6 ("reappeared on placebo") is inverted — "yes" SUBTRACTS a point', () => {
    const reappearedOnPlacebo = allNo({ q6: 'yes' })
    const didNotReappear = allNo({ q6: 'no' })
    expect(computeNaranjoScore(reappearedOnPlacebo)).toBe(computeNaranjoScore(didNotReappear) - 2)
  })

  it('"unknown" always scores 0 regardless of the question', () => {
    const allUnknown: NaranjoAnswersDto = {
      q1: 'unknown',
      q2: 'unknown',
      q3: 'unknown',
      q4: 'unknown',
      q5: 'unknown',
      q6: 'unknown',
      q7: 'unknown',
      q8: 'unknown',
      q9: 'unknown',
      q10: 'unknown',
    }
    expect(computeNaranjoScore(allUnknown)).toBe(0)
  })
})

describe('interpretNaranjoScore() — pure function', () => {
  it.each([
    [9, 'definite'],
    [12, 'definite'],
    [8, 'probable'],
    [5, 'probable'],
    [4, 'possible'],
    [1, 'possible'],
    [0, 'doubtful'],
    [-3, 'doubtful'],
  ] as [number, NaranjoInterpretation][])('score %i interprets as %s', (score, expected) => {
    expect(interpretNaranjoScore(score)).toBe(expected)
  })
})

function buildHarness() {
  const pair = {
    id: 'pair-1',
    caseId: 'case-1',
    companyId: 'company-1',
    whoUmcCategory: null as string | null,
    naranjoScore: null as number | null,
  }

  const causalityFindFirst = jest.fn().mockResolvedValue(pair)
  const causalityUpdate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ ...pair, ...data }))
  const tables = { causalityAssessment: { findFirst: causalityFindFirst, update: causalityUpdate } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new CausalityService(rls as never, auditService)
  return { service, tables, auditLog, causalityFindFirst, causalityUpdate }
}

describe('CausalityService', () => {
  describe('assess()', () => {
    it('sets whoUmcCategory alone without touching naranjo fields', async () => {
      const { service, causalityUpdate } = buildHarness()
      await service.assess(actor, 'case-1', 'pair-1', { whoUmcCategory: 'probable_likely' }, {})

      expect(causalityUpdate).toHaveBeenCalledWith({
        where: { id: 'pair-1' },
        data: {
          whoUmcCategory: 'probable_likely',
          assessedBy: 'user-1',
          assessedAt: expect.any(Date),
        },
      })
    })

    it('sets naranjoAnswers + a server-computed score, ignoring any client score', async () => {
      const { service, causalityUpdate } = buildHarness()
      const answers = allNo({ q2: 'yes' })

      await service.assess(actor, 'case-1', 'pair-1', { naranjoAnswers: answers }, {})

      expect(causalityUpdate).toHaveBeenCalledWith({
        where: { id: 'pair-1' },
        data: {
          naranjoAnswers: answers,
          naranjoScore: computeNaranjoScore(answers),
          assessedBy: 'user-1',
          assessedAt: expect.any(Date),
        },
      })
    })

    it('sets both dimensions in one call', async () => {
      const { service, causalityUpdate } = buildHarness()
      await service.assess(
        actor,
        'case-1',
        'pair-1',
        { whoUmcCategory: 'possible', naranjoAnswers: allNo() },
        {},
      )

      const call = causalityUpdate.mock.calls[0][0]
      expect(call.data.whoUmcCategory).toBe('possible')
      expect(call.data.naranjoScore).toBe(computeNaranjoScore(allNo()))
    })

    it('audits old and new values', async () => {
      const { service, auditLog } = buildHarness()
      await service.assess(actor, 'case-1', 'pair-1', { whoUmcCategory: 'certain' }, {})

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'pv_causality_assessed',
          oldValue: { assessmentId: 'pair-1', whoUmcCategory: null, naranjoScore: null },
          newValue: expect.objectContaining({ assessmentId: 'pair-1', whoUmcCategory: 'certain' }),
        }),
      )
    })

    it('404s for a pair that does not exist on this case/company', async () => {
      const { service, causalityFindFirst } = buildHarness()
      causalityFindFirst.mockResolvedValue(null)
      await expect(
        service.assess(actor, 'case-1', 'missing-pair', { whoUmcCategory: 'certain' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      const platformActor = { ...actor, companyId: null }
      await expect(
        service.assess(platformActor, 'case-1', 'pair-1', { whoUmcCategory: 'certain' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
