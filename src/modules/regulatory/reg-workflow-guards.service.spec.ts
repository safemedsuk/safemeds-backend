import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
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

  const createApplicationFeeInvoiceOnRegistration = jest.fn().mockResolvedValue(undefined)
  const regFeeLedgerService = { createApplicationFeeInvoiceOnRegistration } as never

  new RegWorkflowGuards(
    guardRegistry,
    statusSyncRegistry,
    completenessGateService,
    regConfigService,
    regDeadlineService,
    regPostMarketObligationService,
    regFeeLedgerService,
  ).onModuleInit()

  // Robust against insertion order/count changes: find a registered guard
  // by its own `(recordType, fromStateKey)` pair rather than a magic call
  // index — this file broke on every prior guard addition when it relied
  // on positional indices; this helper is the fix, not another patch.
  const findGuard = (fromStateKey: string, occurrence = 0): TransitionGuardFn => {
    const matches = register.mock.calls.filter((call) => call[1] === fromStateKey)
    if (!matches[occurrence]) {
      throw new Error(`No guard registered on fromStateKey "${fromStateKey}" at occurrence ${occurrence}`)
    }
    return matches[occurrence][2] as TransitionGuardFn
  }

  return {
    register,
    findGuard,
    evaluateInTx,
    statusSyncRegister,
    resolveDeadlineRule,
    computeOrRecompute,
    ensureObligationsForRegistration,
    createApplicationFeeInvoiceOnRegistration,
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

const approvedPayloadBase = { approvalEvidenceDocumentId: 'doc-evidence-1' }

describe('RegWorkflowGuards', () => {
  it('registers exactly 9 guards across Stages 3-7 plus §2.2/§3.1', () => {
    const { register } = buildHarness()
    expect(register).toHaveBeenCalledTimes(9)
  })

  describe('completeness gate (Stage 3)', () => {
    it('disallows the transition and names every missing mandatory document', async () => {
      const { findGuard, evaluateInTx } = buildHarness()
      const guard = findGuard('compiling')

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
      const { findGuard, evaluateInTx } = buildHarness()
      const guard = findGuard('compiling')
      evaluateInTx.mockResolvedValue({ allowed: true, slots: [] })

      const result = await guard({ tx: {} as never, ...baseCtx })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('dispatch-evidence gate (Stage 4, shared by completeness_check and §3.1 renewal_requested)', () => {
    it('is registered identically on both completeness_check and renewal_requested', () => {
      const { findGuard } = buildHarness()
      expect(findGuard('completeness_check')).toBe(findGuard('renewal_requested'))
    })

    it('ignores a toStateKey other than submitted', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('completeness_check')
      const result = await guard({ tx: {} as never, ...baseCtx, toStateKey: 'somewhere_else' })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows when no submission has been generated', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('completeness_check')
      const findFirst = jest.fn().mockResolvedValue(null)
      const tx = { regSubmission: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/no submission package/i)
    })

    it('disallows when the latest submission has no evidence yet', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('completeness_check')
      const findFirst = jest.fn().mockResolvedValue({ id: 'sub-1', evidenceDocumentId: null })
      const tx = { regSubmission: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/no dispatch evidence/i)
    })

    it('allows once the latest submission has evidence — proven from the renewal_requested registration too', async () => {
      const { findGuard } = buildHarness()
      const findFirst = jest.fn().mockResolvedValue({ id: 'sub-1', evidenceDocumentId: 'doc-1' })
      const tx = { regSubmission: { findFirst } } as never

      const result = await findGuard('renewal_requested')({ tx, ...baseCtx, toStateKey: 'submitted' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('variation-application gate (§2.2)', () => {
    it('ignores a toStateKey other than submitted', async () => {
      const { findGuard } = buildHarness()
      const result = await findGuard('variation_application')({
        tx: {} as never,
        ...baseCtx,
        toStateKey: 'somewhere_else',
      })
      expect(result).toEqual({ allowed: true })
    })

    it('names every missing named document (proof of payment, PPB invoice)', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('variation_application')
      const tx = {
        regVariation: {
          findFirstOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'var-1', paymentProofDocumentId: null, invoiceDocumentId: null }),
        },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(
        'This variation is missing required document(s): proof of payment, the PPB variation invoice.',
      )
    })

    it('once both named documents exist, still blocks with no accompanying-change document attached', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('variation_application')
      const count = jest.fn().mockResolvedValue(0)
      const tx = {
        regVariation: {
          findFirstOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'var-1', paymentProofDocumentId: 'doc-pp', invoiceDocumentId: 'doc-inv' }),
        },
        document: { count },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/at least one document describing the change/i)
      expect(count).toHaveBeenCalledWith({
        where: {
          recordType: 'reg_variation',
          recordId: 'var-1',
          id: { notIn: ['doc-pp', 'doc-inv'] },
        },
      })
    })

    it('allows once both named documents and at least one accompanying-change document exist', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('variation_application')
      const tx = {
        regVariation: {
          findFirstOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'var-1', paymentProofDocumentId: 'doc-pp', invoiceDocumentId: 'doc-inv' }),
        },
        document: { count: jest.fn().mockResolvedValue(1) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'submitted' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('open-query guard (Stage 5)', () => {
    it('is registered identically on both submitted and resubmitted_for_review', () => {
      const { findGuard } = buildHarness()
      expect(findGuard('submitted', 0)).toBe(findGuard('resubmitted_for_review', 0))
    })

    it('disallows entering query_received with no open query logged', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('submitted', 0)
      const findFirst = jest.fn().mockResolvedValue(null)
      const tx = { regQuery: { findFirst } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'query_received' })

      expect(findFirst).toHaveBeenCalledWith({
        where: { regDossierId: 'dossier-1', status: { in: ['open', 'in_progress'] } },
      })
      expect(result.allowed).toBe(false)
    })

    it('allows once an open query has been logged', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('submitted', 0)
      const tx = { regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1' }) } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'query_received' })
      expect(result).toEqual({ allowed: true })
    })

    it('ignores any other toStateKey', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('submitted', 0)
      const result = await guard({ tx: {} as never, ...baseCtx, toStateKey: 'approved' })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('query-responded guard (Stage 5)', () => {
    it('disallows resubmission when the latest query is still open', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('responding')
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'open' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result.allowed).toBe(false)
    })

    it('allows resubmission once the latest query is closed', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('responding')
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'closed' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result).toEqual({ allowed: true })
    })

    it('CEO feedback 30 Sep 2026 — also allows resubmission once the latest query is merely "responded" (not yet formally closed)', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('responding')
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'responded' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result).toEqual({ allowed: true })
    })

    it('CEO feedback 30 Sep 2026 — disallows resubmission while the latest query is merely "in_progress"', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('responding')
      const tx = {
        regQuery: { findFirst: jest.fn().mockResolvedValue({ id: 'q1', status: 'in_progress' }) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'resubmitted_for_review' })
      expect(result.allowed).toBe(false)
    })
  })

  describe('approval-data guard (Stage 6/7, extended by §2.4)', () => {
    it('is registered identically on both submitted and resubmitted_for_review', () => {
      const { findGuard } = buildHarness()
      expect(findGuard('submitted', 1)).toBe(findGuard('resubmitted_for_review', 1))
    })

    it('blocks any approval at all — registration, variation, or renewal — with no approval-evidence document', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { registrationNumber: 'PPB-2026-0001', expiresOn: '2032-01-01' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/proving this approval actually succeeded/i)
    })

    it('a fresh registration (no variation) requires a registration number', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({
        id: 'rule-1',
        intervalValue: 5,
        intervalUnit: 'years',
      })
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: { ...approvedPayloadBase } })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/registration number/i)
    })

    it('a fresh registration with no resolvable renewal rule requires an explicit expiresOn', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { ...approvedPayloadBase, registrationNumber: 'PPB-2026-0001' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/expiry date is required/i)
    })

    it('a fresh registration with a number and resolvable expiry still needs proof of payment and the PPB invoice', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({ id: 'rule-1', intervalValue: 5, intervalUnit: 'years' })
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { ...approvedPayloadBase, registrationNumber: 'PPB-2026-0001' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(
        'This registration approval is missing required document(s): proof of payment, the PPB invoice.',
      )
    })

    it('allows a fresh registration once a registration number, a resolvable expiry, and all 3 documents exist', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue({
        id: 'rule-1',
        intervalValue: 5,
        intervalUnit: 'years',
      })
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: {
          ...approvedPayloadBase,
          registrationNumber: 'PPB-2026-0001',
          approvalPaymentProofDocumentId: 'doc-pp',
          approvalInvoiceDocumentId: 'doc-inv',
        },
      })
      expect(result).toEqual({ allowed: true })
    })

    it('a renewal variation never needs a registration number or the payment/invoice pair, only a resolvable expiry and approval evidence', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'var-1', variationType: 'renewal' }),
        },
      } as never

      const blocked = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: { ...approvedPayloadBase } })
      expect(blocked.allowed).toBe(false)
      expect(blocked.reason).toMatch(/expiry date is required/i)

      const allowed = await guard({
        tx,
        ...baseCtx,
        toStateKey: 'approved',
        payload: { ...approvedPayloadBase, expiresOn: '2032-01-01' },
      })
      expect(allowed).toEqual({ allowed: true })
    })

    it('a non-renewal variation is always allowed (given approval evidence) regardless of expiry resolvability', async () => {
      const { findGuard, resolveDeadlineRule } = buildHarness()
      resolveDeadlineRule.mockResolvedValue(null)
      const guard = findGuard('submitted', 1)
      const tx = {
        regDossier: { findUniqueOrThrow: jest.fn().mockResolvedValue(dossierRow) },
        regVariation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'var-1', variationType: 'minor' }),
        },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'approved', payload: { ...approvedPayloadBase } })
      expect(result).toEqual({ allowed: true })
    })

    it('ignores any other toStateKey', async () => {
      const { findGuard } = buildHarness()
      const guard = findGuard('submitted', 1)
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

    it('on a non-approved transition, never writes any of the 3 approval-document fields', async () => {
      const { statusSyncRegister } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx()

      await syncFn({
        tx,
        recordId: 'dossier-1',
        toStateKey: 'submitted',
        companyId: 'company-1',
        payload: { approvalEvidenceDocumentId: 'doc-should-be-ignored' },
      })

      expect((tx as { regDossier: { update: jest.Mock } }).regDossier.update).toHaveBeenCalledWith({
        where: { id: 'dossier-1' },
        data: { status: 'submitted' },
      })
    })

    it('on approved, with no RegVariation, creates a brand-new ProductRegistration, links the dossier back to it, and charges the application fee', async () => {
      const {
        statusSyncRegister,
        computeOrRecompute,
        ensureObligationsForRegistration,
        createApplicationFeeInvoiceOnRegistration,
      } = buildHarness()
      const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const tx = buildSyncTx()

      await syncFn({
        tx,
        recordId: 'dossier-1',
        toStateKey: 'approved',
        companyId: 'company-1',
        actorUserId: 'user-1',
        payload: {
          registrationNumber: 'PPB-2026-0001',
          issuedOn: '2026-03-01',
          approvalEvidenceDocumentId: 'doc-evidence-1',
          approvalPaymentProofDocumentId: 'doc-pp-1',
          approvalInvoiceDocumentId: 'doc-inv-1',
        },
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
      // testing-correction-explanation.md §2.4 — the 3 approval documents
      // are persisted onto RegDossier as part of the same status-write call.
      expect(dossierUpdate).toHaveBeenCalledWith({
        where: { id: 'dossier-1' },
        data: {
          status: 'approved',
          approvalPaymentProofDocumentId: 'doc-pp-1',
          approvalInvoiceDocumentId: 'doc-inv-1',
          approvalEvidenceDocumentId: 'doc-evidence-1',
        },
      })
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
      // testing-correction-explanation.md §1.1 — a fresh registration must
      // also trigger the application-fee auto-invoice on this, the real
      // path a registration actually gets created through.
      expect(createApplicationFeeInvoiceOnRegistration).toHaveBeenCalledWith(
        'company-1',
        'new-reg-1',
        'ke',
        'authority-1',
        'generic_pharma',
        'user-1',
      )
    })

    it("on approved, with an existing renewal RegVariation, extends the existing registration's expiresOn instead of creating a new row, persists only approvalEvidenceDocumentId (no payment/invoice pair), and never re-charges an application fee", async () => {
      const {
        statusSyncRegister,
        resolveDeadlineRule,
        computeOrRecompute,
        ensureObligationsForRegistration,
        createApplicationFeeInvoiceOnRegistration,
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
        payload: { approvalEvidenceDocumentId: 'doc-evidence-1' },
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
      const dossierUpdate = (tx as { regDossier: { update: jest.Mock } }).regDossier.update
      expect(dossierUpdate).toHaveBeenCalledWith({
        where: { id: 'dossier-1' },
        data: {
          status: 'approved',
          approvalPaymentProofDocumentId: undefined,
          approvalInvoiceDocumentId: undefined,
          approvalEvidenceDocumentId: 'doc-evidence-1',
        },
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
      // testing-correction-explanation.md §1.1 — an application fee is
      // charged once, at first registration only; a variation/renewal
      // approval must never re-trigger it.
      expect(createApplicationFeeInvoiceOnRegistration).not.toHaveBeenCalled()
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
              variationType: 'minor',
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
        payload: { manufacturingSiteId: 'site-1', approvalEvidenceDocumentId: 'doc-evidence-1' },
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
