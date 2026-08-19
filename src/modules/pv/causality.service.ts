import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { CausalityAssessment } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import {
  AssessCausalityDto,
  NaranjoAnswersDto,
  NaranjoAnswerValue,
} from './dto/assess-causality.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * The exact 10-question Naranjo Adverse Drug Reaction Probability Scale,
 * point values transcribed directly from `vigicloud docs/Naranjo-assessment.pdf`
 * (itself "Modified from: Naranjo CA et al... Clin Pharmacol Ther 1981").
 * Questions 5 and 6 are the two counter-intuitive ones — a "Yes" answer is
 * actually the *negative* signal for causality (an alternative cause
 * existing, or the reaction reappearing on placebo), so their point
 * values are inverted relative to every other question; this is not a
 * copy-paste bug, it's the real scale.
 */
const NARANJO_POINTS: Record<keyof NaranjoAnswersDto, Record<NaranjoAnswerValue, number>> = {
  q1: { yes: 1, no: 0, unknown: 0 },
  q2: { yes: 2, no: -1, unknown: 0 },
  q3: { yes: 1, no: 0, unknown: 0 },
  q4: { yes: 2, no: -1, unknown: 0 },
  q5: { yes: -1, no: 2, unknown: 0 },
  q6: { yes: -1, no: 1, unknown: 0 },
  q7: { yes: 1, no: 0, unknown: 0 },
  q8: { yes: 1, no: 0, unknown: 0 },
  q9: { yes: 1, no: 0, unknown: 0 },
  q10: { yes: 1, no: 0, unknown: 0 },
}

/** Pure — never trust a client-submitted total, always recompute from the 10 raw answers, which are themselves what's stored (for audit/reproducibility, per the schema's own doc comment on `naranjoAnswers`). */
export function computeNaranjoScore(answers: NaranjoAnswersDto): number {
  return (Object.keys(NARANJO_POINTS) as (keyof NaranjoAnswersDto)[]).reduce(
    (total, key) => total + NARANJO_POINTS[key][answers[key]],
    0,
  )
}

export type NaranjoInterpretation = 'definite' | 'probable' | 'possible' | 'doubtful'

/** The standard, widely-published interpretation bands for the total Naranjo score (Naranjo et al. 1981) — a pure derivation, never stored, so it can never drift from the score it's computed against. */
export function interpretNaranjoScore(score: number): NaranjoInterpretation {
  if (score >= 9) return 'definite'
  if (score >= 5) return 'probable'
  if (score >= 1) return 'possible'
  return 'doubtful'
}

/**
 * VigiCloud Stage 8 — WHO-UMC + Naranjo causality assessment. Both
 * captured **independently** per (suspect product × adverse event) pair,
 * per Final doc §D. The `CausalityAssessment` row for every pair already
 * exists as an empty stub from case creation (Stage 1) — this service
 * only ever updates an existing stub, never creates one, since the N×M
 * pairing itself is fixed at intake time (adding a product/event later
 * would need its own migration path, out of scope here).
 */
@Injectable()
export class CausalityService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async assess(
    actor: AuthenticatedUser,
    caseId: string,
    assessmentId: string,
    dto: AssessCausalityDto,
    meta: RequestMeta,
  ): Promise<CausalityAssessment> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.causalityAssessment.findFirst({
        where: { id: assessmentId, caseId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Causality assessment pair not found on this case',
        })
      }

      const naranjoScore = dto.naranjoAnswers ? computeNaranjoScore(dto.naranjoAnswers) : undefined

      const updated = await tx.causalityAssessment.update({
        where: { id: assessmentId },
        data: {
          ...(dto.whoUmcCategory !== undefined ? { whoUmcCategory: dto.whoUmcCategory } : {}),
          ...(dto.naranjoAnswers !== undefined
            ? { naranjoAnswers: { ...dto.naranjoAnswers }, naranjoScore }
            : {}),
          assessedBy: actor.sub,
          assessedAt: new Date(),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_causality_assessed',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        oldValue: {
          assessmentId,
          whoUmcCategory: existing.whoUmcCategory,
          naranjoScore: existing.naranjoScore,
        },
        newValue: {
          assessmentId,
          whoUmcCategory: updated.whoUmcCategory,
          naranjoScore: updated.naranjoScore,
        },
        ip: meta.ip,
      })

      return updated
    })
  }
}
