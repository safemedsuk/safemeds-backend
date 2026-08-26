import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { REG_REGISTRATION_RECORD_TYPE } from './reg-dossier.service'
import { RegWorkflowGuards } from './reg-workflow-guards.service'

function buildHarness() {
  const register = jest.fn()
  const guardRegistry = { register } as never

  const evaluateInTx = jest.fn()
  const completenessGateService = { evaluateInTx } as never

  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never

  const resolveDeadlineRule = jest.fn().mockResolvedValue(null)
  const regConfigService = { resolveDeadlineRule } as never

  const computeOrRecompute = jest.fn().mockResolvedValue(null)
  const regDeadlineService = { computeOrRecompute } as never

  const ensureObligationsForRegistration = jest.fn().mockResolvedValue(undefined)
  const regPostMarketObligationService = { ensureObligationsForRegistration } as never

  new RegWorkflowGuards(
    guardRegistry,
    statusSyncRegistry,
    completenessGateService,
    regConfigService,
    regDeadlineService,
    regPostMarketObligationService,
  ).onModuleInit()

  return {
    register,
    evaluateInTx,
    statusSyncRegister,
    resolveDeadlineRule,
    computeOrRecompute,
    ensureObligationsForRegistration,
  }
}

const baseCtx = {
  companyId: 'company-1',
  recordId: 'dossier-1',
  toStateKey: 'completeness_check',
  actorUserId: 'user-1',
}

const dossierRow = {
  id: 'dossier-1',
  productId: 'product-1',
  authorityId: 'authority-1',
  productClass: 'generic_pharma',
  authority: { countryId: 'ke' },
}

describe('RegWorkflowGuards', () => {
  it('registers exactly 7 guards across Stages 3-7', () => {
    const { register } = buildHarness()

    expect(register).toHaveBeenCalledTimes(7)
    expect(register).toHaveBeenNthCalledWith(
      1,
      REG_REGISTRATION_RECORD_TYPE,
      'compiling',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      2,
      REG_REGISTRATION_RECORD_TYPE,
      'completeness_check',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      3,
      REG_REGISTRATION_RECORD_TYPE,
      'submitted',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      4,
      REG_REGISTRATION_RECORD_TYPE,
      'resubmitted_for_review',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      5,
      REG_REGISTRATION_RECORD_TYPE,
      'responding',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      6,
      REG_REGISTRATION_RECORD_TYPE,
      'submitted',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      7,
      REG_REGISTRATION_RECORD_TYPE,
      'resubmitted_for_review',
      expect.any(Function),
    )
  })

  describe('completeness gate (Stage 3)', () => {
    it('disallows the transition and names every missing mandatory document', async () => {
      const { register, evaluateInTx } = buildHarness()
      const guard = register.mock.calls[0][2] as TransitionGuardFn

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
          {
            slotId: 's2',
            label: 'GMP Certificate',
            ctdModule: null,
            isMandatory: true,
            attached: true,
            met: true,
          },
        ],
      })

      const tx = {} as never
      const result = await guard({ tx, ...baseCtx })

      expect(evaluateInTx).toHaveBeenCalledWith(tx, 'dossier-1')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('This dossier is missing required document(s): CPP.')
    })

    it('allows the transition once every mandatory slot is met', async () => {
      const { register, evaluateInTx } = buildHarness()
      const guard = register.mock.calls[0][2] as TransitionGuardFn
      evaluateInTx.mockResolvedValue({ allowed: true, slots: [] })

      const result = await guard({ tx: {} as never, ...baseCtx })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('evidence gate (Stage 4)', () => {
    it('ignores a toStateKey other than submitted', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn
      const result = await guard({ tx: {} as never, ...baseCtx, toStateKey: 'somewhere_else' })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows when no submission has been generated', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn
      const findFirst = jest.fn().mockResolvedValue(null)
      const tx = { regSubmission: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/no submission package/i)
    })

    it('disallows when the latest submission has no evidence yet', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn
      const findFirst = jest.fn().mockResolvedValue({ id: 'sub-1', evidenceDocumentId: null })
      const tx = { regSubmission: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/no dispatch evidence/i)
    })

    it('allows once the latest submission has evidence', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn
      const findFirst = jest.fn().mockResolvedValue({ id: 'sub-1', evidenceDocumentId: 'doc-1' })
      const tx = { regSubmission: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('open-query guard (Stage 5)', () => {
    it('is registered identically on both submitted and resubmitted_for_review', () => {
      const { register } = buildHarness()
      expect(register.mock.calls[2][2]).toBe(register.mock.calls[3][2])
    })

    it('disallows entering query_received with no open query logged', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn
      const findFirst = jest.fn().mockResolvedValue(null)
      const tx = { regQuery: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'query_received' })

      expect(findFirst).toHaveBeenCalledWith({
        where: { regDossierId: 'dossier-1', status: 'open' },
      })
      expect(result.allowed).toBe(false)
    })

    it('allows once an open query has been logged', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn
      const tx = { regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1' }) } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'query_received' })
      expect(result).toEqual({ allowed: true })
    })

    it('ignores any other toStateKey', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn
      const result = await guard({ tx: {} as never, ...baseCtx, toStateKey: 'approved' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('query-responded guard (Stage 5)', () => {
    it('disallows resubmission when the latest query is still open', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[4][2] as TransitionGuardFn
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'open' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result.allowed).toBe(false)
    })

    it('allows resubmission once the latest query is closed', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[4][2] as TransitionGuardFn
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'closed' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('approval-data guard (Stage 6/7)', () => {
    it('is registered identically on both submitted and resubmitted_for_review', () => {
      const { register } = buildHarness()
      expect(register.mock.calls[5][2]).toBe(register.mock.calls[6][2])
    })

    it('a fresh registration (no variation) requires a registration number', async () => {
      const { register, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({
        id: 'rule-1',
        intervalValue: 5,
        intervalUnit: 'years',
      })
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: {} })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/registration number/i)
    })

    it('a fresh registration with no resolvable renewal rule requires an explicit expiresOn', async () => {
      const { register, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { registrationNumber: 'PPB-2026-0001' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/expiry date is required/i)
    })

    it('allows a fresh registration once a registration number and a resolvable expiry both exist', async () => {
      const { register, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({
        id: 'rule-1',
        intervalValue: 5,
        intervalUnit: 'years',
      })
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { registrationNumber: 'PPB-2026-0001' },
      })
      expect(result).toEqual({ allowed: true })
    })

    it('a renewal variation never needs a registration number, only a resolvable expiry', async () => {
      const { register, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'var-1', variationType: 'renewal' }),
        },
      } as never

      const blocked = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: {} })
      expect(blocked.allowed).toBe(false)
      expect(blocked.reason).toMatch(/expiry date is required/i)

      const allowed = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { expiresOn: '2032-01-01' },
      })
      expect(allowed).toEqual({ allowed: true })
    })

    it('a non-renewal variation is always allowed regardless of expiry resolvability', async () => {
      const { register, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'var-1', variationType: 'labeling_change' }),
        },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: {} })
      expect(result).toEqual({ allowed: true })
    })

    it('ignores any other toStateKey', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[5][2] as TransitionGuardFn
      const result = await guard({ tx: {} as never, ...baseCtx, toStateKey: 'rejected' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('status-sync function', () => {
    function buildSyncTx(overrides: Record<string, unknown> = {}) {
      return {
        regDossier: {
          update: jest.fn().mockResolvedValue(undefined),
          findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow),
        },
        regVariation: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue(undefined),
        },
        productRegistration: {
          create: jest.fn().mockResolvedValue({ id: 'new-reg-1' }),
          update: jest.fn().mockResolvedValue(undefined),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'existing-reg-1', expiresOn: new Date('2027-01-01') }),
        },
        ...overrides,
      } as never
    }

    it('always writes RegDossier.status to the new state', async () => {
      const { statusSyncRegister } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx()

      await syncFn({ tx, recordId: 'dossier-1', toStateKey: 'compiling', companyId: 'company-1' })

      expect((tx as { regDossier: { update: jest.Mock } }).regDossier.update).toHaveBeenCalledWith({
        where: { id: 'dossier-1' },
        data: { status: 'compiling' },
      })
    })

    it('on approved, with no RegVariation, creates a brand-new ProductRegistration and links the dossier back to it', async () => {
      const { statusSyncRegister, computeOrRecompute, ensureObligationsForRegistration } =
        buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx()

      await syncFn({
        tx,
        recordId: 'dossier-1',
        toStateKey: 'approved',
        companyId: 'company-1',
        actorUserId: 'user-1',
        payload: { registrationNumber: 'PPB-2026-0001', issuedOn: '2026-03-01' },
      })

      const create = (tx as { productRegistration: { create: jest.Mock } }).productRegistration
        .create
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            registrationNumber: 'PPB-2026-0001',
            status: 'active',
            productId: 'product-1',
            authorityId: 'authority-1',
          }),
        }),
      )
      const dossierUpdate = (tx as { regDossier: { update: jest.Mock } }).regDossier.update
      expect(dossierUpdate).toHaveBeenCalledWith({
        where: { id: 'dossier-1' },
        data: { productRegistrationId: 'new-reg-1' },
      })
      expect(computeOrRecompute).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: 'reg_registration_renewal',
          recordId: 'new-reg-1',
          obligationType: 'renewal',
        }),
      )
      // RegCloud Stage 8 — a freshly-approved registration immediately starts tracking whatever post-market obligation types are already configured.
      expect(ensureObligationsForRegistration).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ id: 'new-reg-1' }),
        'user-1',
      )
    })

    it("on approved, with an existing renewal RegVariation, extends the existing registration's expiresOn instead of creating a new row", async () => {
      const {
        statusSyncRegister,
        resolveDeadlineRule,
        computeOrRecompute,
        ensureObligationsForRegistration,
      } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({
        id: 'rule-1',
        intervalValue: 5,
        intervalUnit: 'years',
      })
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx({
        regVariation: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: 'var-1',
              productRegistrationId: 'existing-reg-1',
              variationType: 'renewal',
            }),
          update: jest.fn().mockResolvedValue(undefined),
        },
        productRegistration: {
          create: jest.fn(),
          update: jest
            .fn()
            .mockResolvedValue({ id: 'existing-reg-1', expiresOn: new Date('2032-01-01') }),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'existing-reg-1', expiresOn: new Date('2027-01-01') }),
        },
      })

      await syncFn({
        tx,
        recordId: 'dossier-1',
        toStateKey: 'approved',
        companyId: 'company-1',
        actorUserId: 'user-1',
        payload: {},
      })

      const create = (tx as { productRegistration: { create: jest.Mock } }).productRegistration
        .create
      expect(create).not.toHaveBeenCalled()
      const update = (tx as { productRegistration: { update: jest.Mock } }).productRegistration
        .update
      expect(update).toHaveBeenCalledWith({
        where: { id: 'existing-reg-1' },
        data: { expiresOn: new Date('2032-01-01') },
      })
      const variationUpdate = (tx as { regVariation: { update: jest.Mock } }).regVariation.update
      expect(variationUpdate).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: { status: 'approved', approvedAt: expect.any(Date) },
      })
      expect(computeOrRecompute).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: 'existing-reg-1',
          triggerDate: new Date('2027-01-01'),
        }),
      )
      // RegCloud Stage 8 — a renewal re-checks obligation coverage too (a variation may have changed productClass).
      expect(ensureObligationsForRegistration).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ id: 'existing-reg-1' }),
        'user-1',
      )
    })

    it('on approved, with a non-renewal RegVariation, updates optional fields but never touches expiresOn', async () => {
      const { statusSyncRegister } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx({
        regVariation: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: 'var-1',
              productRegistrationId: 'existing-reg-1',
              variationType: 'labeling_change',
            }),
          update: jest.fn().mockResolvedValue(undefined),
        },
      })

      await syncFn({
        tx,
        recordId: 'dossier-1',
        toStateKey: 'approved',
        companyId: 'company-1',
        actorUserId: 'user-1',
        payload: { manufacturingSiteId: 'site-1' },
      })

      const update = (tx as { productRegistration: { update: jest.Mock } }).productRegistration
        .update
      expect(update).toHaveBeenCalledWith({
        where: { id: 'existing-reg-1' },
        data: { manufacturingSiteId: 'site-1' },
      })
    })

    it('on rejected, marks a wrapping RegVariation rejected', async () => {
      const { statusSyncRegister } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx({
        regVariation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'var-1' }),
          update: jest.fn().mockResolvedValue(undefined),
        },
      })

      await syncFn({ tx, recordId: 'dossier-1', toStateKey: 'rejected', companyId: 'company-1' })

      expect(
        (tx as { regVariation: { update: jest.Mock } }).regVariation.update,
      ).toHaveBeenCalledWith({ where: { id: 'var-1' }, data: { status: 'rejected' } })
    })

    it('on rejected, with no wrapping RegVariation, does nothing beyond the status write', async () => {
      const { statusSyncRegister } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx()

      await syncFn({ tx, recordId: 'dossier-1', toStateKey: 'rejected', companyId: 'company-1' })

      expect(
        (tx as { regVariation: { update: jest.Mock } }).regVariation.update,
      ).not.toHaveBeenCalled()
    })
  })
})
