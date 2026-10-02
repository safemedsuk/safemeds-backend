import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegDossierService } from './reg-dossier.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditQuery = jest
    .fn()
    .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never
  const resolveRequirement = jest.fn()
  const regConfigService = { resolveRequirement } as never

  const productFindUnique = jest.fn().mockResolvedValue({ id: 'product-1', companyId: 'company-1' })
  const authorityFindUnique = jest.fn().mockResolvedValue({ id: 'authority-1', countryId: 'ke' })
  const regDossierCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const regDossierFindUniqueOrThrow = jest.fn()
  const regDossierFindUnique = jest.fn()
  const regDossierFindMany = jest.fn().mockResolvedValue([])
  const regDossierCount = jest.fn().mockResolvedValue(0)
  const regDossierDocumentSlotCreateMany = jest.fn().mockResolvedValue({ count: 0 })
  const regDossierDocumentSlotFindUnique = jest.fn()
  const regDossierDocumentSlotUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const regDossierDocumentSlotCreate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve(data))
  const documentFindUnique = jest.fn().mockResolvedValue({ id: 'doc-1', companyId: 'company-1' })

  // Unrestricted by default — matches every other "resolve*"-style
  // graceful default so pre-existing tests see the exact same unfiltered
  // `where` they always did.
  const getEffectiveAccess = jest
    .fn()
    .mockResolvedValue({ unrestricted: true, facilityIds: [], countryIds: [] })
  const locationScopeService = { getEffectiveAccess } as never

  const instantiate = jest.fn().mockResolvedValue({ id: 'instance-1' })
  const workflowService = { instantiate } as never

  const evaluateInTx = jest.fn().mockResolvedValue({ allowed: true, slots: [] })
  const completenessGateService = { evaluateInTx, evaluate: jest.fn() } as never

  const workflowInstanceFindFirst = jest.fn().mockResolvedValue(null)
  const regVariationFindFirst = jest.fn().mockResolvedValue(null)
  const relianceApplicationFindUnique = jest
    .fn()
    .mockResolvedValue({ id: 'reliance-1', companyId: 'company-1' })

  const resolveEffective = jest.fn().mockResolvedValue('full_service')
  const engagementModelService = { resolveEffective } as never

  const tables = {
    product: { findUnique: productFindUnique },
    regulatoryAuthority: { findUnique: authorityFindUnique },
    regDossier: {
      create: regDossierCreate,
      findUniqueOrThrow: regDossierFindUniqueOrThrow,
      findUnique: regDossierFindUnique,
      findMany: regDossierFindMany,
      count: regDossierCount,
    },
    regDossierDocumentSlot: {
      createMany: regDossierDocumentSlotCreateMany,
      findUnique: regDossierDocumentSlotFindUnique,
      update: regDossierDocumentSlotUpdate,
      create: regDossierDocumentSlotCreate,
    },
    document: { findUnique: documentFindUnique },
    workflowInstance: { findFirst: workflowInstanceFindFirst },
    regVariation: { findFirst: regVariationFindFirst },
    relianceApplication: { findUnique: relianceApplicationFindUnique },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const service = new RegDossierService(
    rls as never,
    auditService,
    regConfigService,
    locationScopeService,
    workflowService,
    completenessGateService,
    engagementModelService,
  )
  return {
    service,
    auditLog,
    resolveRequirement,
    regDossierCreate,
    regDossierFindUniqueOrThrow,
    regDossierFindMany,
    regDossierDocumentSlotCreateMany,
    regDossierDocumentSlotFindUnique,
    regDossierDocumentSlotUpdate,
    documentFindUnique,
    getEffectiveAccess,
    instantiate,
    evaluateInTx,
    regDossierFindUnique,
    workflowInstanceFindFirst,
    regVariationFindFirst,
    auditQuery,
  }
}

describe('RegDossierService.create', () => {
  it('pre-populates one slot per checklist item when an active requirement resolves', async () => {
    const {
      service,
      resolveRequirement,
      regDossierCreate,
      regDossierFindUniqueOrThrow,
      regDossierDocumentSlotCreateMany,
    } = buildHarness()
    resolveRequirement.mockResolvedValue({
      id: 'req-1',
      documentDefinitions: [
        { id: 'doc-def-1', ctdModule: 'Module 1' },
        { id: 'doc-def-2', ctdModule: 'Module 3' },
      ],
    })
    regDossierFindUniqueOrThrow.mockResolvedValue({ id: 'dossier-1', documentSlots: [] })

    await service.create(
      actor,
      { productId: 'product-1', authorityId: 'authority-1', productClass: 'generic_pharma' },
      {},
    )

    const generatedDossierId = regDossierCreate.mock.calls[0][0].data.id as string
    expect(regDossierDocumentSlotCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          requiredDocumentDefinitionId: 'doc-def-1',
          regDossierId: generatedDossierId,
        }),
        expect.objectContaining({
          requiredDocumentDefinitionId: 'doc-def-2',
          regDossierId: generatedDossierId,
        }),
      ],
    })
  })

  it('creates the dossier at status "planning" and instantiates a real reg_registration workflow, scoped to the authority\'s own country', async () => {
    const {
      service,
      resolveRequirement,
      regDossierCreate,
      regDossierFindUniqueOrThrow,
      instantiate,
    } = buildHarness()
    resolveRequirement.mockResolvedValue(null)
    regDossierFindUniqueOrThrow.mockResolvedValue({ id: 'dossier-1', documentSlots: [] })

    await service.create(
      actor,
      { productId: 'product-1', authorityId: 'authority-1', productClass: 'generic_pharma' },
      {},
    )

    expect(regDossierCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'planning' }) }),
    )
    const generatedDossierId = regDossierCreate.mock.calls[0][0].data.id as string
    expect(instantiate).toHaveBeenCalledWith(
      actor,
      'reg_registration',
      generatedDossierId,
      'ke',
      {},
    )
  })

  it('still creates the dossier with zero slots when nothing resolves — an unconfigured market never blocks dossier creation', async () => {
    const {
      service,
      resolveRequirement,
      regDossierCreate,
      regDossierDocumentSlotCreateMany,
      regDossierFindUniqueOrThrow,
    } = buildHarness()
    resolveRequirement.mockResolvedValue(null)
    regDossierFindUniqueOrThrow.mockResolvedValue({ id: 'dossier-2', documentSlots: [] })

    const result = await service.create(
      actor,
      { productId: 'product-1', authorityId: 'authority-1', productClass: 'unconfigured_class' },
      {},
    )

    expect(regDossierCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ regulatoryRequirementId: undefined, status: 'planning' }),
      }),
    )
    expect(regDossierDocumentSlotCreateMany).not.toHaveBeenCalled()
    expect(result.id).toBe('dossier-2')
  })
})

describe('RegDossierService — attach/detach document', () => {
  it('attachDocument writes documentId onto the correct slot after verifying both the slot and the document belong to this company', async () => {
    const {
      service,
      regDossierDocumentSlotFindUnique,
      regDossierDocumentSlotUpdate,
      documentFindUnique,
    } = buildHarness()
    regDossierDocumentSlotFindUnique.mockResolvedValue({ id: 'slot-1', regDossierId: 'dossier-1' })

    await service.attachDocument(actor, 'dossier-1', 'slot-1', { documentId: 'doc-1' }, {})

    expect(documentFindUnique).toHaveBeenCalledWith({ where: { id: 'doc-1' } })
    expect(regDossierDocumentSlotUpdate).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { documentId: 'doc-1' },
    })
  })

  it('attachDocument 404s when the slot does not belong to the named dossier — never lets a cross-dossier slot ID through', async () => {
    const { service, regDossierDocumentSlotFindUnique } = buildHarness()
    regDossierDocumentSlotFindUnique.mockResolvedValue({
      id: 'slot-1',
      regDossierId: 'some-other-dossier',
    })

    await expect(
      service.attachDocument(actor, 'dossier-1', 'slot-1', { documentId: 'doc-1' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('attachDocument 404s when the document does not resolve — a cross-tenant document ID is invisible under RLS, not a silent success', async () => {
    const { service, regDossierDocumentSlotFindUnique, documentFindUnique } = buildHarness()
    regDossierDocumentSlotFindUnique.mockResolvedValue({ id: 'slot-1', regDossierId: 'dossier-1' })
    documentFindUnique.mockResolvedValue(null)

    await expect(
      service.attachDocument(actor, 'dossier-1', 'slot-1', { documentId: 'other-company-doc' }, {}),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } })
  })

  it('detachDocument clears documentId back to null', async () => {
    const { service, regDossierDocumentSlotFindUnique, regDossierDocumentSlotUpdate } =
      buildHarness()
    regDossierDocumentSlotFindUnique.mockResolvedValue({
      id: 'slot-1',
      regDossierId: 'dossier-1',
      documentId: 'doc-1',
    })

    await service.detachDocument(actor, 'dossier-1', 'slot-1', {})

    expect(regDossierDocumentSlotUpdate).toHaveBeenCalledWith({
      where: { id: 'slot-1' },
      data: { documentId: null },
    })
  })
})

describe('RegDossierService.get — Stage 1/3 enrichment', () => {
  it('reads the live workflow state over the stored column, and includes the completeness result and transition history', async () => {
    const { service, regDossierFindUnique, workflowInstanceFindFirst, evaluateInTx, auditQuery } =
      buildHarness()
    regDossierFindUnique.mockResolvedValue({
      id: 'dossier-1',
      status: 'planning',
      documentSlots: [],
    })
    workflowInstanceFindFirst.mockResolvedValue({
      id: 'instance-1',
      currentState: { stateKey: 'compiling' },
    })
    evaluateInTx.mockResolvedValue({
      allowed: false,
      slots: [
        {
          slotId: 's1',
          label: 'CPP',
          ctdModule: null,
          isMandatory: true,
          attached: false,
          met: false,
        },
      ],
    })
    auditQuery.mockResolvedValue({
      data: [
        {
          oldValue: { stateKey: 'planning' },
          newValue: { stateKey: 'compiling' },
          actorName: 'Jane',
          occurredAt: new Date('2026-08-22'),
        },
      ],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    })

    const result = await service.get(actor, 'dossier-1')

    expect(result.status).toBe('compiling')
    expect(result.workflowInstanceId).toBe('instance-1')
    expect(result.completeness.allowed).toBe(false)
    expect(result.variation).toBeNull()
    expect(result.transitionHistory).toEqual([
      {
        fromStateKey: 'planning',
        toStateKey: 'compiling',
        note: null,
        actorName: 'Jane',
        occurredAt: new Date('2026-08-22'),
      },
    ])
  })

  it('surfaces a Stage 7 variation summary when this dossier is wrapped by one', async () => {
    const { service, regDossierFindUnique, regVariationFindFirst, auditQuery } = buildHarness()
    regDossierFindUnique.mockResolvedValue({
      id: 'dossier-1',
      status: 'compiling',
      documentSlots: [],
    })
    regVariationFindFirst.mockResolvedValue({
      id: 'var-1',
      variationType: 'renewal',
      productRegistrationId: 'reg-1',
      productRegistration: { registrationNumber: 'PPB-2026-0001' },
    })
    auditQuery.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
    })

    const result = await service.get(actor, 'dossier-1')

    expect(result.variation).toEqual({
      id: 'var-1',
      variationType: 'renewal',
      productRegistrationId: 'reg-1',
      productRegistrationNumber: 'PPB-2026-0001',
    })
  })

  it('falls back to the stored status column when no workflow instance exists yet', async () => {
    const { service, regDossierFindUnique, workflowInstanceFindFirst } = buildHarness()
    regDossierFindUnique.mockResolvedValue({
      id: 'dossier-1',
      status: 'planning',
      documentSlots: [],
    })
    workflowInstanceFindFirst.mockResolvedValue(null)

    const result = await service.get(actor, 'dossier-1')

    expect(result.status).toBe('planning')
    expect(result.workflowInstanceId).toBeNull()
  })

  it('404s when the dossier does not exist', async () => {
    const { service, regDossierFindUnique } = buildHarness()
    regDossierFindUnique.mockResolvedValue(null)

    await expect(service.get(actor, 'missing')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('RegDossierService.list — location scoping (Stage 0.6)', () => {
  it('an unrestricted actor sees every dossier regardless of country', async () => {
    const { service, regDossierFindMany } = buildHarness()

    await service.list(actor, { page: 1, limit: 25 })

    expect(regDossierFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ authority: expect.anything() }),
      }),
    )
  })

  it('a market/facility-scoped actor only sees dossiers under an authority in one of their granted countries', async () => {
    const { service, regDossierFindMany, getEffectiveAccess } = buildHarness()
    getEffectiveAccess.mockResolvedValue({
      unrestricted: false,
      facilityIds: [],
      countryIds: ['ke'],
    })

    await service.list(actor, { page: 1, limit: 25 })

    expect(regDossierFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authority: { countryId: { in: ['ke'] } } }),
      }),
    )
  })
})

describe('RegDossierService.list — kind derivation (§2.5)', () => {
  it('a dossier with no wrapping RegVariation is kind "registration", variation null', async () => {
    const { service, regDossierFindMany } = buildHarness()
    regDossierFindMany.mockResolvedValue([
      { id: 'd1', product: { brandName: 'Amoxiclav' }, regVariation: null },
    ])

    const result = await service.list(actor, { page: 1, limit: 25 })

    expect(result.data[0].kind).toBe('registration')
    expect(result.data[0].variation).toBeNull()
  })

  it('a dossier wrapped by variationType "renewal" is kind "renewal"', async () => {
    const { service, regDossierFindMany } = buildHarness()
    regDossierFindMany.mockResolvedValue([
      {
        id: 'd1',
        product: { brandName: 'Amoxiclav' },
        regVariation: {
          id: 'var-1',
          variationType: 'renewal',
          displayCode: 'REN-00001-PPB-2026-0142',
          productRegistrationId: 'reg-1',
          productRegistration: { registrationNumber: 'PPB-2026-0142' },
        },
      },
    ])

    const result = await service.list(actor, { page: 1, limit: 25 })

    expect(result.data[0].kind).toBe('renewal')
    expect(result.data[0].variation).toEqual({
      id: 'var-1',
      variationType: 'renewal',
      displayCode: 'REN-00001-PPB-2026-0142',
      productRegistrationId: 'reg-1',
      productRegistrationNumber: 'PPB-2026-0142',
    })
  })

  it('a dossier wrapped by any non-renewal variationType is kind "variation"', async () => {
    const { service, regDossierFindMany } = buildHarness()
    regDossierFindMany.mockResolvedValue([
      {
        id: 'd1',
        product: { brandName: 'Amoxiclav' },
        regVariation: {
          id: 'var-1',
          variationType: 'major',
          displayCode: 'VAR-00001-PPB-2026-0142',
          productRegistrationId: 'reg-1',
          productRegistration: { registrationNumber: 'PPB-2026-0142' },
        },
      },
    ])

    const result = await service.list(actor, { page: 1, limit: 25 })

    expect(result.data[0].kind).toBe('variation')
  })
})
