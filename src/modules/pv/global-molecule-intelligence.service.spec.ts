import { ForbiddenException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GlobalMoleculeIntelligenceService } from './global-molecule-intelligence.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const ownCases = [
    {
      id: 'case-1',
      countryOfOccurrenceId: 'ke',
      seriousnessClass: 'serious',
      receivedDate: new Date('2026-06-15'),
      countryOfOccurrence: { name: 'Kenya' },
    },
    {
      id: 'case-2',
      countryOfOccurrenceId: 'ke',
      seriousnessClass: 'non_serious',
      receivedDate: new Date('2026-07-15'),
      countryOfOccurrence: { name: 'Kenya' },
    },
    {
      id: 'case-3',
      countryOfOccurrenceId: 'ug',
      seriousnessClass: 'serious',
      receivedDate: new Date('2026-07-20'),
      countryOfOccurrence: { name: 'Uganda' },
    },
  ]

  const suspectProductFindMany = jest
    .fn()
    .mockResolvedValue([
      { activeSubstanceName: 'PARACETAMOL' },
      { activeSubstanceName: 'Amoxicillin' },
    ])
  const ownCaseFindMany = jest.fn().mockResolvedValue(ownCases)
  const ownTables = {
    case: { findMany: ownCaseFindMany },
    suspectProduct: { findMany: suspectProductFindMany },
  }

  // testing-todo 19.1 — the cross-tenant `runWithSystemAccess()` read was
  // removed along with the cross-portfolio feature itself; this harness no
  // longer stubs it at all, so any future accidental reintroduction of a
  // cross-tenant call here would fail loudly (no such method on `rls`)
  // rather than silently succeed against a stale mock.
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof ownTables) => unknown) => fn(ownTables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new GlobalMoleculeIntelligenceService(rls as never, auditService)
  return { service, ownCaseFindMany, auditLog }
}

describe('GlobalMoleculeIntelligenceService', () => {
  describe('listOwnMolecules()', () => {
    it('returns the distinct, sorted active-substance names', async () => {
      const { service } = buildHarness()
      const result = await service.listOwnMolecules(actor)
      expect(result).toEqual(['Amoxicillin', 'PARACETAMOL'])
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.listOwnMolecules({ ...actor, companyId: null })).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('getMoleculeView()', () => {
    it('aggregates own-tenant cases by country, seriousness, and month', async () => {
      const { service } = buildHarness()
      const view = await service.getMoleculeView(actor, ' paracetamol ', {})

      expect(view.moleculeName).toBe('paracetamol')
      expect(view.own.totalCases).toBe(3)
      expect(view.own.byCountry.find((c) => c.countryId === 'ke')?.caseCount).toBe(2)
      expect(view.own.byCountry.find((c) => c.countryId === 'ug')?.caseCount).toBe(1)
      expect(view.own.bySeriousness.find((s) => s.seriousnessClass === 'serious')?.caseCount).toBe(
        2,
      )
      expect(view.own.byMonth).toEqual(
        expect.arrayContaining([
          { month: '2026-06', caseCount: 1 },
          { month: '2026-07', caseCount: 2 },
        ]),
      )
    })

    // testing-todo 19.1 — the cross-portfolio aggregate (a previously
    // count-only, anonymized cross-tenant read) was deliberately removed:
    // showing any cross-company statistics to another tenant was judged not
    // acceptable, a risk to client trust. This asserts the removal, not just
    // its absence — a future reintroduction of any cross-tenant field on
    // this response would fail this test.
    it('the response is purely tenant-scoped — no cross-tenant field exists on the view at all', async () => {
      const { service } = buildHarness()
      const view = await service.getMoleculeView(actor, 'paracetamol', {})

      expect(Object.keys(view)).toEqual(['moleculeName', 'own'])
      expect(JSON.stringify(view)).not.toMatch(
        /company-2|company-3|crossPortfolio|otherTenant|contributingTenant/,
      )
    })

    it("audits the query on the requesting tenant's own trail", async () => {
      const { service, auditLog } = buildHarness()
      await service.getMoleculeView(actor, 'paracetamol', { ip: '1.2.3.4' })

      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: 'company-1',
          action: 'molecule_intelligence_queried',
          newValue: expect.objectContaining({ moleculeName: 'paracetamol' }),
        }),
      )
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.getMoleculeView({ ...actor, companyId: null }, 'paracetamol', {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })
})
