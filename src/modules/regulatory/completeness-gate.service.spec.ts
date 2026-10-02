import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CompletenessGateService } from './completeness-gate.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const findMany = jest.fn().mockResolvedValue([])
  const regVariationFindFirst = jest.fn().mockResolvedValue(null)
  const tx = {
    regDossierDocumentSlot: { findMany },
    regVariation: { findFirst: regVariationFindFirst },
  } as never
  const rls = { runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) => fn(tx) }
  const service = new CompletenessGateService(rls as never)
  return { service, findMany, regVariationFindFirst, tx }
}

describe('CompletenessGateService', () => {
  it('allows a dossier with zero slots at all — an unconfigured market never blocks', async () => {
    const { service, tx } = buildHarness()
    const result = await service.evaluateInTx(tx, 'dossier-1')
    expect(result).toEqual({ allowed: true, guidanceOnly: false, slots: [] })
  })

  it('is met by any slot with no requiredDocumentDefinition (an ad-hoc slot is never itself a blocker)', async () => {
    const { service, findMany, tx } = buildHarness()
    findMany.mockResolvedValue([
      {
        id: 'slot-1',
        labelOverride: 'Extra cover letter',
        ctdModule: null,
        documentId: null,
        requiredDocumentDefinition: null,
      },
    ])

    const result = await service.evaluateInTx(tx, 'dossier-1')

    expect(result.allowed).toBe(true)
    expect(result.slots).toEqual([
      {
        slotId: 'slot-1',
        label: 'Extra cover letter',
        ctdModule: null,
        isMandatory: false,
        attached: false,
        met: true,
      },
    ])
  })

  it('disallows when a mandatory slot has no document attached', async () => {
    const { service, findMany, tx } = buildHarness()
    findMany.mockResolvedValue([
      {
        id: 'slot-1',
        labelOverride: null,
        ctdModule: 'Module 1',
        documentId: null,
        requiredDocumentDefinition: { name: 'CPP', isMandatory: true },
      },
    ])

    const result = await service.evaluateInTx(tx, 'dossier-1')

    expect(result.allowed).toBe(false)
    expect(result.slots[0]).toEqual({
      slotId: 'slot-1',
      label: 'CPP',
      ctdModule: 'Module 1',
      isMandatory: true,
      attached: false,
      met: false,
    })
  })

  it('a non-mandatory checklist slot is met even without a document', async () => {
    const { service, findMany, tx } = buildHarness()
    findMany.mockResolvedValue([
      {
        id: 'slot-1',
        labelOverride: null,
        ctdModule: null,
        documentId: null,
        requiredDocumentDefinition: { name: 'Optional annex', isMandatory: false },
      },
    ])

    const result = await service.evaluateInTx(tx, 'dossier-1')

    expect(result.allowed).toBe(true)
    expect(result.slots[0].met).toBe(true)
  })

  it('allows once every mandatory slot has a document attached', async () => {
    const { service, findMany, tx } = buildHarness()
    findMany.mockResolvedValue([
      {
        id: 'slot-1',
        labelOverride: null,
        ctdModule: null,
        documentId: 'doc-1',
        requiredDocumentDefinition: { name: 'CPP', isMandatory: true },
      },
      {
        id: 'slot-2',
        labelOverride: null,
        ctdModule: null,
        documentId: null,
        requiredDocumentDefinition: { name: 'Optional annex', isMandatory: false },
      },
    ])

    const result = await service.evaluateInTx(tx, 'dossier-1')

    expect(result.allowed).toBe(true)
  })

  it('evaluate() wraps evaluateInTx inside an RLS-scoped transaction', async () => {
    const { service, findMany } = buildHarness()
    const result = await service.evaluate(actor, 'dossier-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { regDossierId: 'dossier-1' },
      include: { requiredDocumentDefinition: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(result).toEqual({ allowed: true, guidanceOnly: false, slots: [] })
  })

  // testing-correction-explanation.md §1.2 — a variation/renewal dossier
  // (one wrapped by a real RegVariation row) never blocks on this
  // checklist, regardless of what's linked — the checklist configured in
  // the admin console was always meant for a fresh registration only.
  describe('a variation/renewal dossier (wrapped by a real RegVariation row)', () => {
    it('always allows, even with an unmet mandatory slot, and reports guidanceOnly: true', async () => {
      const { service, findMany, regVariationFindFirst, tx } = buildHarness()
      regVariationFindFirst.mockResolvedValue({ id: 'var-1' })
      findMany.mockResolvedValue([
        {
          id: 'slot-1',
          labelOverride: null,
          ctdModule: 'Module 1',
          documentId: null,
          requiredDocumentDefinition: { name: 'CPP', isMandatory: true },
        },
      ])

      const result = await service.evaluateInTx(tx, 'dossier-1')

      expect(result.allowed).toBe(true)
      expect(result.guidanceOnly).toBe(true)
      expect(result.slots[0]).toEqual({
        slotId: 'slot-1',
        label: 'CPP',
        ctdModule: 'Module 1',
        isMandatory: false,
        attached: false,
        met: true,
      })
      expect(regVariationFindFirst).toHaveBeenCalledWith({
        where: { regDossierId: 'dossier-1' },
        select: { id: true },
      })
    })

    it('a dossier with no wrapping RegVariation still enforces mandatory documents as before', async () => {
      const { service, findMany, regVariationFindFirst, tx } = buildHarness()
      regVariationFindFirst.mockResolvedValue(null)
      findMany.mockResolvedValue([
        {
          id: 'slot-1',
          labelOverride: null,
          ctdModule: null,
          documentId: null,
          requiredDocumentDefinition: { name: 'CPP', isMandatory: true },
        },
      ])

      const result = await service.evaluateInTx(tx, 'dossier-1')

      expect(result.allowed).toBe(false)
      expect(result.guidanceOnly).toBe(false)
      expect(result.slots[0].isMandatory).toBe(true)
    })
  })
})
