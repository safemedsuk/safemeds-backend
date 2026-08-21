import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { PV_CASE_RECORD_TYPE } from './pv-case.service'
import { PvWorkflowGuards } from './pv-workflow-guards.service'

function buildHarness() {
  const register = jest.fn()
  const guardRegistry = { register } as never

  const evaluateInTx = jest.fn()
  const validityGateService = { evaluateInTx } as never

  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never

  new PvWorkflowGuards(guardRegistry, validityGateService, statusSyncRegistry).onModuleInit()

  return { register, evaluateInTx, statusSyncRegister }
}

const baseCtx = {
  companyId: 'company-1',
  recordId: 'case-1',
  toStateKey: 'triage',
  actorUserId: 'user-1',
}

describe('PvWorkflowGuards', () => {
  it('registers exactly five guards — intake source-document, intake validity-gate, medical_review causality, narrative four-eyes, submitted close-obligations', () => {
    const { register } = buildHarness()

    expect(register).toHaveBeenCalledTimes(5)
    expect(register).toHaveBeenNthCalledWith(1, PV_CASE_RECORD_TYPE, 'intake', expect.any(Function))
    expect(register).toHaveBeenNthCalledWith(2, PV_CASE_RECORD_TYPE, 'intake', expect.any(Function))
    expect(register).toHaveBeenNthCalledWith(
      3,
      PV_CASE_RECORD_TYPE,
      'medical_review',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      4,
      PV_CASE_RECORD_TYPE,
      'narrative',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      5,
      PV_CASE_RECORD_TYPE,
      'submitted',
      expect.any(Function),
    )
  })

  it('registers a pv_case status-sync function that writes Case.status to the new state (real-usage bug bash, 16 Aug 2026)', async () => {
    const { statusSyncRegister } = buildHarness()

    expect(statusSyncRegister).toHaveBeenCalledWith(PV_CASE_RECORD_TYPE, expect.any(Function))

    const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
    const update = jest.fn()
    const tx = { case: { update } } as never
    await syncFn({ tx, recordId: 'case-1', toStateKey: 'triage', companyId: 'company-1' })

    expect(update).toHaveBeenCalledWith({ where: { id: 'case-1' }, data: { status: 'triage' } })
  })

  it('the status-sync function also sets Case.closedAt when the new state is closed_archived (workflow-map stage 9)', async () => {
    const { statusSyncRegister } = buildHarness()

    const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
    const update = jest.fn()
    const tx = { case: { update } } as never
    await syncFn({ tx, recordId: 'case-1', toStateKey: 'closed_archived', companyId: 'company-1' })

    expect(update).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      data: { status: 'closed_archived', closedAt: expect.any(Date) },
    })
  })

  describe('source-document guard', () => {
    it('disallows a transition with zero source documents', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[0][2] as TransitionGuardFn

      const count = jest.fn().mockResolvedValue(0)
      const tx = { sourceDocument: { count } } as never

      const result = await guard({ tx, ...baseCtx })

      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/source document/i)
      expect(count).toHaveBeenCalledWith({ where: { companyId: 'company-1', caseId: 'case-1' } })
    })

    it('allows the transition once at least one source document exists', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[0][2] as TransitionGuardFn

      const tx = { sourceDocument: { count: jest.fn().mockResolvedValue(1) } } as never
      const result = await guard({ tx, ...baseCtx })

      expect(result).toEqual({ allowed: true })
    })
  })

  describe('validity-gate guard (Stage 4)', () => {
    it('disallows the transition and names every missing criterion when the gate fails', async () => {
      const { register, evaluateInTx } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn

      evaluateInTx.mockResolvedValue({
        allowed: false,
        criteria: [
          { key: 'identifiable_patient', label: 'Identifiable patient', met: false },
          { key: 'identifiable_reporter', label: 'Identifiable reporter', met: true },
          { key: 'suspect_product', label: 'At least one suspect product', met: true },
          { key: 'adverse_event', label: 'At least one adverse event', met: false },
        ],
      })

      const tx = {} as never
      const result = await guard({ tx, ...baseCtx })

      expect(evaluateInTx).toHaveBeenCalledWith(tx, 'case-1')
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(
        'This case is missing: Identifiable patient, At least one adverse event.',
      )
    })

    it('allows the transition once every criterion is met', async () => {
      const { register, evaluateInTx } = buildHarness()
      const guard = register.mock.calls[1][2] as TransitionGuardFn

      evaluateInTx.mockResolvedValue({ allowed: true, criteria: [] })

      const result = await guard({ tx: {} as never, ...baseCtx })

      expect(result).toEqual({ allowed: true })
    })
  })

  describe('causality-completeness guard (Stage 8)', () => {
    it('disallows the transition and reports the count of incomplete pairs', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn

      const findMany = jest.fn().mockResolvedValue([
        { id: 'pair-1', whoUmcCategory: 'possible', naranjoScore: 3 },
        { id: 'pair-2', whoUmcCategory: null, naranjoScore: null },
        { id: 'pair-3', whoUmcCategory: 'certain', naranjoScore: null },
      ])
      const tx = { causalityAssessment: { findMany } } as never

      const result = await guard({ tx, ...baseCtx })

      expect(findMany).toHaveBeenCalledWith({ where: { companyId: 'company-1', caseId: 'case-1' } })
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(
        '2 of 3 product-reaction pair(s) still need a complete causality assessment (both WHO-UMC and Naranjo) before this case can leave Medical Review.',
      )
    })

    it('allows the transition once every pair has both dimensions set', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn

      const findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'pair-1', whoUmcCategory: 'possible', naranjoScore: 3 }])
      const tx = { causalityAssessment: { findMany } } as never

      const result = await guard({ tx, ...baseCtx })
      expect(result).toEqual({ allowed: true })
    })

    it('allows a case with zero causality pairs (nothing to be incomplete)', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[2][2] as TransitionGuardFn

      const tx = { causalityAssessment: { findMany: jest.fn().mockResolvedValue([]) } } as never
      const result = await guard({ tx, ...baseCtx })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('four-eyes guard (Stage 9)', () => {
    it('only applies to the approval path into quality_check — a reject-back transition is never blocked', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[3][2] as TransitionGuardFn

      const count = jest.fn()
      const tx = { causalityAssessment: { count } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'medical_review' })

      expect(result).toEqual({ allowed: true })
      expect(count).not.toHaveBeenCalled()
    })

    it("disallows approval when the actor is the same person who assessed this case's causality", async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[3][2] as TransitionGuardFn

      const count = jest.fn().mockResolvedValue(1)
      const tx = { causalityAssessment: { count } } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'quality_check' })

      expect(count).toHaveBeenCalledWith({
        where: { companyId: 'company-1', caseId: 'case-1', assessedBy: 'user-1' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/cannot be the same person/i)
    })

    it("allows approval when the actor never assessed this case's causality", async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[3][2] as TransitionGuardFn

      const tx = { causalityAssessment: { count: jest.fn().mockResolvedValue(0) } } as never
      const result = await guard({ tx, ...baseCtx, toStateKey: 'quality_check' })

      expect(result).toEqual({ allowed: true })
    })
  })

  describe('close-obligations guard (workflow-map stage 9)', () => {
    it('disallows closing while a follow-up cycle is still open', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[4][2] as TransitionGuardFn

      const caseFollowUpFindFirst = jest
        .fn()
        .mockResolvedValue({ id: 'followup-1', status: 'pending_attempt_1' })
      const tx = {
        caseFollowUp: { findFirst: caseFollowUpFindFirst },
        duplicateReview: { findFirst: jest.fn() },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'closed_archived' })

      expect(caseFollowUpFindFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          caseId: 'case-1',
          status: { in: ['pending_attempt_1', 'pending_attempt_2'] },
        },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/open follow-up cycle/i)
    })

    it('disallows closing while a possible-duplicate review is unresolved, on either side of the pairing', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[4][2] as TransitionGuardFn

      const duplicateReviewFindFirst = jest
        .fn()
        .mockResolvedValue({ id: 'dup-1', status: 'possible' })
      const tx = {
        caseFollowUp: { findFirst: jest.fn().mockResolvedValue(null) },
        duplicateReview: { findFirst: duplicateReviewFindFirst },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'closed_archived' })

      expect(duplicateReviewFindFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          status: 'possible',
          OR: [{ caseId: 'case-1' }, { matchedCaseId: 'case-1' }],
        },
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/unresolved possible-duplicate/i)
    })

    it('allows closing once there is no open follow-up and no unresolved duplicate review', async () => {
      const { register } = buildHarness()
      const guard = register.mock.calls[4][2] as TransitionGuardFn

      const tx = {
        caseFollowUp: { findFirst: jest.fn().mockResolvedValue(null) },
        duplicateReview: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never

      const result = await guard({ tx, ...baseCtx, toStateKey: 'closed_archived' })
      expect(result).toEqual({ allowed: true })
    })
  })
})
