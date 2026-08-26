import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BenefitRiskService } from './benefit-risk.service'

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

interface CaseFixture {
  id: string
  companyId: string
  duplicateOfCaseId: string | null
  awarenessDate: Date
  seriousnessClass: string | null
  expectednessFlag: 'listed' | 'unlisted' | 'not_assessed'
  productIds: string[]
  outcomes: string[]
  whoUmcCategories: (string | null)[]
}

function buildHarness(cases: CaseFixture[], products: string[] = []) {
  const productRows = new Map(products.map((id) => [id, { id, companyId: 'company-1' }]))

  const findFirstProduct = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) =>
      Promise.resolve(productRows.get(where.id) ?? null),
    )

  const findManyCase = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: { suspectProducts: { some: { productId: string } } }
        awarenessDate?: { gte: Date; lte: Date }
      }) => {
        const productId = where.suspectProducts.some.productId
        const range = (where as unknown as { awarenessDate?: { gte: Date; lte: Date } })
          .awarenessDate
        const matching = cases.filter((c) => {
          if (!c.productIds.includes(productId)) return false
          if (c.duplicateOfCaseId !== null) return false
          if (range && (c.awarenessDate < range.gte || c.awarenessDate > range.lte)) return false
          return true
        })
        return Promise.resolve(
          matching.map((c) => ({
            seriousnessClass: c.seriousnessClass,
            expectednessFlag: c.expectednessFlag,
            adverseEvents: c.outcomes.map((outcome) => ({ outcome })),
            suspectProducts: [
              {
                causalityAssessments: c.whoUmcCategories.map((whoUmcCategory) => ({
                  whoUmcCategory,
                })),
              },
            ],
          })),
        )
      },
    )

  const tx = { product: { findFirst: findFirstProduct }, case: { findMany: findManyCase } }
  const rls = { runAsCompany: (_companyId: string, fn: (t: typeof tx) => unknown) => fn(tx) }

  const service = new BenefitRiskService(rls as never)
  return { service }
}

describe('BenefitRiskService', () => {
  it('aggregates seriousness, expectedness, outcome, and causality across matching cases', async () => {
    const { service } = buildHarness(
      [
        {
          id: 'case-1',
          companyId: 'company-1',
          duplicateOfCaseId: null,
          awarenessDate: new Date('2026-03-01'),
          seriousnessClass: 'serious',
          expectednessFlag: 'unlisted',
          productIds: ['product-1'],
          outcomes: ['recovered', 'not_recovered'],
          whoUmcCategories: ['probable_likely'],
        },
        {
          id: 'case-2',
          companyId: 'company-1',
          duplicateOfCaseId: null,
          awarenessDate: new Date('2026-04-01'),
          seriousnessClass: 'non_serious',
          expectednessFlag: 'listed',
          productIds: ['product-1'],
          outcomes: ['fatal'],
          whoUmcCategories: [null],
        },
      ],
      ['product-1'],
    )

    const summary = await service.getSummary(actor, 'product-1')
    expect(summary.caseCount).toBe(2)
    expect(summary.seriousnessBreakdown).toMatchObject({ serious: 1, non_serious: 1, fatal: 0 })
    expect(summary.expectednessBreakdown).toMatchObject({ listed: 1, unlisted: 1, not_assessed: 0 })
    expect(summary.adverseEventOutcomeBreakdown).toMatchObject({
      recovered: 1,
      not_recovered: 1,
      fatal: 1,
    })
    expect(summary.causalityBreakdown).toMatchObject({ probable_likely: 1, not_assessed: 1 })
  })

  it('excludes confirmed-duplicate cases', async () => {
    const { service } = buildHarness(
      [
        {
          id: 'case-1',
          companyId: 'company-1',
          duplicateOfCaseId: 'case-master',
          awarenessDate: new Date('2026-03-01'),
          seriousnessClass: 'serious',
          expectednessFlag: 'unlisted',
          productIds: ['product-1'],
          outcomes: [],
          whoUmcCategories: [],
        },
      ],
      ['product-1'],
    )

    const summary = await service.getSummary(actor, 'product-1')
    expect(summary.caseCount).toBe(0)
  })

  it('filters by period when both bounds are supplied', async () => {
    const { service } = buildHarness(
      [
        {
          id: 'case-1',
          companyId: 'company-1',
          duplicateOfCaseId: null,
          awarenessDate: new Date('2026-01-01'),
          seriousnessClass: 'serious',
          expectednessFlag: 'unlisted',
          productIds: ['product-1'],
          outcomes: [],
          whoUmcCategories: [],
        },
        {
          id: 'case-2',
          companyId: 'company-1',
          duplicateOfCaseId: null,
          awarenessDate: new Date('2026-06-01'),
          seriousnessClass: 'serious',
          expectednessFlag: 'unlisted',
          productIds: ['product-1'],
          outcomes: [],
          whoUmcCategories: [],
        },
      ],
      ['product-1'],
    )

    const summary = await service.getSummary(
      actor,
      'product-1',
      new Date('2026-05-01'),
      new Date('2026-07-01'),
    )
    expect(summary.caseCount).toBe(1)
  })

  it('404s on an unknown product', async () => {
    const { service } = buildHarness([], [])
    await expect(service.getSummary(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
  })

  it('rejects an actor with no company', async () => {
    const { service } = buildHarness([], [])
    await expect(service.getSummary(noCompanyActor, 'product-1')).rejects.toThrow(
      ForbiddenException,
    )
  })
})
