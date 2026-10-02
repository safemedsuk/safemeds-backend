import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { RECALL_RECORD_TYPE } from './recall.service'
import { RecallClosureCheckResult } from './recall-closure-gate.service'
import { RecallWorkflowGuards } from './recall-workflow-guards.service'

function buildHarness(closureCheckResult?: RecallClosureCheckResult) {
  const guardRegister = jest.fn()
  const guardRegistry = { register: guardRegister } as never

  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never

  const evaluate = jest
    .fn()
    .mockResolvedValue(closureCheckResult ?? { allClear: true, gates: [] })
  const closureGateService = { evaluate } as never

  new RecallWorkflowGuards(guardRegistry, statusSyncRegistry, closureGateService).onModuleInit()

  return { guardRegister, statusSyncRegister, evaluate }
}

function findGuard(
  guardRegister: jest.Mock,
  stateKey: string,
  matcher: (result: unknown) => boolean = () => true,
): TransitionGuardFn {
  const calls = guardRegister.mock.calls.filter(
    (call) => call[0] === RECALL_RECORD_TYPE && call[1] === stateKey,
  )
  const match = calls.find((call) => matcher(call[2])) ?? calls[0]
  return match[2] as TransitionGuardFn
}

describe('RecallWorkflowGuards', () => {
  it('registers the real 9-state lifecycle guard set (approval gate, closure backstop, cancellation ×2)', () => {
    const { guardRegister } = buildHarness()
    expect(guardRegister).toHaveBeenCalledTimes(4)
    expect(guardRegister).toHaveBeenCalledWith(
      RECALL_RECORD_TYPE,
      'under_assessment',
      expect.any(Function),
    )
    expect(guardRegister).toHaveBeenCalledWith(
      RECALL_RECORD_TYPE,
      'closure_pending',
      expect.any(Function),
    )
    expect(guardRegister).toHaveBeenCalledWith(RECALL_RECORD_TYPE, 'draft', expect.any(Function))
    // 'under_assessment' is registered twice — once for the approval
    // gate, once (shared with 'draft') for the cancellation-reason guard.
    const underAssessmentCalls = guardRegister.mock.calls.filter(
      (call) => call[0] === RECALL_RECORD_TYPE && call[1] === 'under_assessment',
    )
    expect(underAssessmentCalls).toHaveLength(2)
  })

  it('registers a status-sync function', () => {
    const { statusSyncRegister } = buildHarness()
    expect(statusSyncRegister).toHaveBeenCalledWith(RECALL_RECORD_TYPE, expect.any(Function))
  })

  describe('approval gate (under_assessment -> approved)', () => {
    async function runApprovalGate(
      guardRegister: jest.Mock,
      overrides: { scope?: unknown; risk?: unknown } = {},
    ) {
      const calls = guardRegister.mock.calls.filter(
        (call) => call[0] === RECALL_RECORD_TYPE && call[1] === 'under_assessment',
      )
      // The approval-gate guard is the one that actually queries
      // recallScopeVersion/riskAssessment — distinguish it from the
      // shared cancellation-reason guard by arity of behavior, not
      // registration order (both are legitimately possible orderings).
      const findFirst = jest.fn().mockResolvedValue(overrides.scope ?? null)
      const riskFindFirst = jest.fn().mockResolvedValue(overrides.risk ?? null)
      const tx = {
        recallScopeVersion: { findFirst },
        riskAssessment: { findFirst: riskFindFirst },
      } as never

      for (const call of calls) {
        const guard = call[2] as TransitionGuardFn
        const result = await guard({
          tx,
          companyId: 'company-1',
          recordId: 'recall-1',
          toStateKey: 'approved',
          actorUserId: 'user-1',
        })
        if (findFirst.mock.calls.length > 0) return result
      }
      throw new Error('approval gate guard not found')
    }

    it('ignores a toStateKey other than approved', async () => {
      const { guardRegister } = buildHarness()
      const guard = findGuard(guardRegister, 'under_assessment')
      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'cancelled',
        actorUserId: 'user-1',
        note: 'a real reason',
      })
      expect(result).toEqual({ allowed: true })
    })

    it('blocks approval when no scope version has been frozen', async () => {
      const { guardRegister } = buildHarness()
      const result = await runApprovalGate(guardRegister, { scope: null })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/freeze a product\/batch scope/i)
    })

    it('blocks approval when a scope is frozen but no risk assessment exists', async () => {
      const { guardRegister } = buildHarness()
      const result = await runApprovalGate(guardRegister, {
        scope: { id: 'scope-1', status: 'frozen' },
        risk: null,
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/hazard\/risk evaluation/i)
    })

    it('allows approval once a frozen scope and a risk assessment both exist', async () => {
      const { guardRegister } = buildHarness()
      const result = await runApprovalGate(guardRegister, {
        scope: { id: 'scope-1', status: 'frozen' },
        risk: { id: 'risk-1' },
      })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('closure gate (closure_pending -> closed, Stage 10.6’s real 8-gate check)', () => {
    it('ignores a toStateKey other than closed, never even calling the closure-gate service', async () => {
      const { guardRegister, evaluate } = buildHarness()
      const guard = findGuard(guardRegister, 'closure_pending')

      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'execution',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
      expect(evaluate).not.toHaveBeenCalled()
    })

    it('disallows closing and names every failed gate explicitly, never a bare "cannot close"', async () => {
      const { guardRegister } = buildHarness({
        allClear: false,
        gates: [
          { gate: 1, name: 'All mandatory obligations complete or waived', passed: true, reason: null },
          {
            gate: 2,
            name: 'No unresolved blocking discrepancy',
            passed: false,
            reason: '1 blocking discrepancy(ies) have no approved exception',
          },
          {
            gate: 6,
            name: 'A recall-investigation CAPA is linked',
            passed: false,
            reason: 'No CAPA has been opened for the root-cause investigation yet',
          },
        ],
      })
      const guard = findGuard(guardRegister, 'closure_pending')

      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'closed',
        actorUserId: 'user-1',
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/Gate 2 \(No unresolved blocking discrepancy\)/)
      expect(result.reason).toMatch(/Gate 6 \(A recall-investigation CAPA is linked\)/)
      expect(result.reason).not.toMatch(/Gate 1 /)
    })

    it('allows closing once every gate passes', async () => {
      const { guardRegister, evaluate } = buildHarness({ allClear: true, gates: [] })
      const guard = findGuard(guardRegister, 'closure_pending')
      const tx = {} as never

      const result = await guard({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'closed',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
      expect(evaluate).toHaveBeenCalledWith(tx, 'company-1', 'recall-1')
    })
  })

  describe('cancellation reason guard (draft/under_assessment -> cancelled)', () => {
    it('ignores a toStateKey other than cancelled', async () => {
      const { guardRegister } = buildHarness()
      const guard = findGuard(guardRegister, 'draft')
      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'under_assessment',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows cancellation with no note', async () => {
      const { guardRegister } = buildHarness()
      const guard = findGuard(guardRegister, 'draft')
      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'cancelled',
        actorUserId: 'user-1',
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/reason is required to cancel/i)
    })

    it('allows cancellation once a real reason note is given, from either originating state', async () => {
      const { guardRegister } = buildHarness()
      const draftGuard = findGuard(guardRegister, 'draft') // the only guard registered on 'draft'
      const underAssessmentCalls = guardRegister.mock.calls.filter(
        (call) => call[0] === RECALL_RECORD_TYPE && call[1] === 'under_assessment',
      )
      // The cancellation guard is the *second* of the two guards
      // registered on 'under_assessment' — the first is the unrelated
      // approval gate.
      const cancellationGuard = underAssessmentCalls[underAssessmentCalls.length - 1][2] as TransitionGuardFn
      for (const guard of [draftGuard, cancellationGuard]) {
        const result = await guard({
          tx: {} as never,
          companyId: 'company-1',
          recordId: 'recall-1',
          toStateKey: 'cancelled',
          actorUserId: 'user-1',
          note: 'Regulator directive withdrawn',
        })
        expect(result).toEqual({ allowed: true })
      }
    })
  })

  describe('status sync', () => {
    it('keeps Recall.status in sync on an ordinary transition, with no closedAt', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { recall: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'execution',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'recall-1' },
        data: { status: 'execution' },
      })
    })

    it('also stamps closedAt when entering closed', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { recall: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'closed',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'recall-1' },
        data: { status: 'closed', closedAt: expect.any(Date) },
      })
    })

    it('also stamps closedAt when entering cancelled', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { recall: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'cancelled',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'recall-1' },
        data: { status: 'cancelled', closedAt: expect.any(Date) },
      })
    })
  })
})
