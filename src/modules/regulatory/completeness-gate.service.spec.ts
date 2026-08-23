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
  const tx = { regDossierDocumentSlot: { findMany } } as never
  const rls = { runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) => fn(tx) }
  const service = new CompletenessGateService(rls as never)
  return { service, findMany, tx }
}

describe('CompletenessGateService', () => {
  it('allows a dossier with zero slots at all — an unconfigured market never blocks', async () => {
    const { service, tx } = buildHarness()
    const result = await service.evaluateInTx(tx, 'dossier-1')
    expect(result).toEqual({ allowed: true, slots: [] })
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
    expect(result).toEqual({ allowed: true, slots: [] })
  })
})
