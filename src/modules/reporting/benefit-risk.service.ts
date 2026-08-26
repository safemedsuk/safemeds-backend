import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ExpectednessFlag, Prisma, ReactionOutcome, WhoUmcCausality } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'

export interface BenefitRiskSummary {
  subjectId: string
  periodStart: Date | null
  periodEnd: Date | null
  caseCount: number
  seriousnessBreakdown: Record<string, number>
  expectednessBreakdown: Record<ExpectednessFlag, number>
  adverseEventOutcomeBreakdown: Record<ReactionOutcome, number>
  causalityBreakdown: Record<WhoUmcCausality | 'not_assessed', number>
}

interface CaseAggregateRow {
  seriousnessClass: string | null
  expectednessFlag: ExpectednessFlag
  adverseEvents: { outcome: ReactionOutcome }[]
  causalityCategories: (WhoUmcCausality | null)[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Benefit-risk data is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function emptyBreakdown<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
}

function summarizeCases(
  subjectId: string,
  rows: CaseAggregateRow[],
  periodStart?: Date,
  periodEnd?: Date,
): BenefitRiskSummary {
  const seriousnessBreakdown: Record<string, number> = {
    fatal: 0,
    serious: 0,
    non_serious: 0,
    not_assessed: 0,
  }
  const expectednessBreakdown = emptyBreakdown<ExpectednessFlag>([
    'listed',
    'unlisted',
    'not_assessed',
  ])
  const adverseEventOutcomeBreakdown = emptyBreakdown<ReactionOutcome>([
    'recovered',
    'recovering',
    'not_recovered',
    'recovered_with_sequelae',
    'fatal',
    'unknown',
  ])
  const causalityBreakdown = emptyBreakdown<WhoUmcCausality | 'not_assessed'>([
    'certain',
    'probable_likely',
    'possible',
    'unlikely',
    'conditional_unclassified',
    'unassessable_unclassifiable',
    'not_assessed',
  ])

  for (const row of rows) {
    const seriousnessKey = row.seriousnessClass ?? 'not_assessed'
    seriousnessBreakdown[seriousnessKey] = (seriousnessBreakdown[seriousnessKey] ?? 0) + 1
    expectednessBreakdown[row.expectednessFlag] += 1

    for (const ae of row.adverseEvents) {
      adverseEventOutcomeBreakdown[ae.outcome] += 1
    }
    for (const category of row.causalityCategories) {
      const key = category ?? 'not_assessed'
      causalityBreakdown[key] += 1
    }
  }

  return {
    subjectId,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    caseCount: rows.length,
    seriousnessBreakdown,
    expectednessBreakdown,
    adverseEventOutcomeBreakdown,
    causalityBreakdown,
  }
}

/**
 * VigiCloud Stage 18 — "a data view, not a separate workflow," per the
 * build spec's own text. Read-only aggregation over cumulative AE data,
 * reused three ways: standalone per-product (`GET
 * /reporting/benefit-risk/:productId`, a screen on its own), standalone
 * per-clinical-trial (DSUR's own subject), and inline inside
 * `PeriodicReportService.generate()`'s own PSUR/PBRER/DSUR/PADER/
 * CIOMS-II content — the same numbers every time, via the shared
 * `summarizeCases()` aggregation, never recomputed differently per
 * call site.
 */
@Injectable()
export class BenefitRiskService {
  constructor(private readonly rls: RlsService) {}

  async getSummary(
    actor: AuthenticatedUser,
    productId: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<BenefitRiskSummary> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      this.computeSummary(tx, companyId, productId, periodStart, periodEnd),
    )
  }

  /** Shared with `PeriodicReportService`, which already holds an open `tx` from its own RLS transaction — avoids opening a second, nested one for the exact same read. */
  async computeSummary(
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<BenefitRiskSummary> {
    const product = await tx.product.findFirst({ where: { id: productId, companyId } })
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
    }

    const cases = await tx.case.findMany({
      where: {
        companyId,
        duplicateOfCaseId: null,
        suspectProducts: { some: { productId } },
        ...(periodStart && periodEnd
          ? { awarenessDate: { gte: periodStart, lte: periodEnd } }
          : {}),
      },
      select: {
        seriousnessClass: true,
        expectednessFlag: true,
        adverseEvents: { select: { outcome: true } },
        suspectProducts: {
          where: { productId },
          select: { causalityAssessments: { select: { whoUmcCategory: true } } },
        },
      },
    })

    const rows: CaseAggregateRow[] = cases.map((c) => ({
      seriousnessClass: c.seriousnessClass,
      expectednessFlag: c.expectednessFlag,
      adverseEvents: c.adverseEvents,
      causalityCategories: c.suspectProducts.flatMap((sp) =>
        sp.causalityAssessments.map((ca) => ca.whoUmcCategory),
      ),
    }))

    return summarizeCases(productId, rows, periodStart, periodEnd)
  }

  /** DSUR's own subject is a clinical trial, not a product — same aggregation, scoped by `Case.clinicalTrialId` instead of a suspect-product link. */
  async computeSummaryForTrial(
    tx: Prisma.TransactionClient,
    companyId: string,
    clinicalTrialId: string,
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<BenefitRiskSummary> {
    const trial = await tx.clinicalTrial.findFirst({ where: { id: clinicalTrialId, companyId } })
    if (!trial) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
    }

    const cases = await tx.case.findMany({
      where: {
        companyId,
        duplicateOfCaseId: null,
        clinicalTrialId,
        ...(periodStart && periodEnd
          ? { awarenessDate: { gte: periodStart, lte: periodEnd } }
          : {}),
      },
      select: {
        seriousnessClass: true,
        expectednessFlag: true,
        adverseEvents: { select: { outcome: true } },
        suspectProducts: { select: { causalityAssessments: { select: { whoUmcCategory: true } } } },
      },
    })

    const rows: CaseAggregateRow[] = cases.map((c) => ({
      seriousnessClass: c.seriousnessClass,
      expectednessFlag: c.expectednessFlag,
      adverseEvents: c.adverseEvents,
      causalityCategories: c.suspectProducts.flatMap((sp) =>
        sp.causalityAssessments.map((ca) => ca.whoUmcCategory),
      ),
    }))

    return summarizeCases(clinicalTrialId, rows, periodStart, periodEnd)
  }
}
