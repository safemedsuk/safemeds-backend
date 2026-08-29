import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { WorkflowService } from './workflow.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

const lockedInstanceRow = {
  id: 'instance-1',
  definition_id: 'def-1',
  current_state_id: 'state-intake',
  record_type: 'pv_case',
  record_id: 'record-1',
  version: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const sign = jest.fn().mockResolvedValue({ id: 'sig-1' })
  const signatureService = { sign } as never
  const createForWorkflowState = jest.fn().mockResolvedValue({ id: 'task-1' })
  const closeOpenForRecord = jest.fn().mockResolvedValue(undefined)
  const tasksService = { createForWorkflowState, closeOpenForRecord } as never

  const workflowDefinitionFindFirst = jest.fn()
  const workflowDefinitionFindUnique = jest.fn()
  const workflowInstanceCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const workflowInstanceFindUnique = jest.fn()
  const workflowInstanceUpdate = jest
    .fn()
    .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }))
  const workflowTransitionFindMany = jest.fn()
  const workflowTransitionFindFirst = jest.fn()
  const workflowStateFindFirst = jest.fn()
  const queryRaw = jest.fn().mockResolvedValue([lockedInstanceRow])

  const tables = {
    workflowDefinition: {
      findFirst: workflowDefinitionFindFirst,
      findUnique: workflowDefinitionFindUnique,
    },
    workflowInstance: {
      create: workflowInstanceCreate,
      findUnique: workflowInstanceFindUnique,
      update: workflowInstanceUpdate,
    },
    workflowTransition: {
      findMany: workflowTransitionFindMany,
      findFirst: workflowTransitionFindFirst,
    },
    workflowState: { findFirst: workflowStateFindFirst },
    $queryRaw: queryRaw,
  }
  const prisma = {
    ...tables,
    $transaction: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const guardCheck = jest.fn().mockResolvedValue({ allowed: true })
  const guardRegistry = { check: guardCheck } as never

  const statusSync = jest.fn().mockResolvedValue(undefined)
  const statusSyncRegistry = { sync: statusSync } as never

  const service = new WorkflowService(
    prisma as never,
    rls as never,
    auditService,
    signatureService,
    tasksService,
    guardRegistry,
    statusSyncRegistry,
  )
  return {
    service,
    auditLog,
    sign,
    createForWorkflowState,
    closeOpenForRecord,
    guardCheck,
    statusSync,
    workflowDefinitionFindFirst,
    workflowInstanceCreate,
    workflowInstanceFindUnique,
    workflowInstanceUpdate,
    workflowTransitionFindMany,
    workflowTransitionFindFirst,
    workflowStateFindFirst,
    queryRaw,
  }
}

describe('WorkflowService.instantiate', () => {
  it("creates the instance at the definition's initial state and audits it", async () => {
    const { service, workflowDefinitionFindFirst, workflowInstanceCreate, auditLog } =
      buildHarness()
    workflowDefinitionFindFirst.mockResolvedValue({
      id: 'def-1',
      states: [
        { id: 'state-intake', stateKey: 'intake', isInitial: true },
        { id: 'state-triage', stateKey: 'triage', isInitial: false },
      ],
      transitions: [],
    })

    const instance = await service.instantiate(actor, 'pv_case', 'record-1', null, {})

    expect(workflowInstanceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ definitionId: 'def-1', currentStateId: 'state-intake' }),
      }),
    )
    expect(instance.currentStateId).toBe('state-intake')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'workflow_instantiated' }),
    )
  })

  it('falls back to the global default definition when no country-specific one is active', async () => {
    const { service, workflowDefinitionFindFirst } = buildHarness()
    workflowDefinitionFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'def-default',
      states: [{ id: 's1', stateKey: 'intake', isInitial: true }],
      transitions: [],
    })

    const instance = await service.instantiate(actor, 'pv_case', 'record-1', 'country-ke', {})

    expect(workflowDefinitionFindFirst).toHaveBeenCalledTimes(2)
    expect(instance.definitionId).toBe('def-default')
  })
})

describe('WorkflowService.availableTransitions', () => {
  it('marks a transition allowed only when the actor holds the required role', async () => {
    const { service, workflowInstanceFindUnique, workflowTransitionFindMany } = buildHarness()
    workflowInstanceFindUnique.mockResolvedValue({
      id: 'instance-1',
      definitionId: 'def-1',
      currentStateId: 'state-intake',
    })
    workflowTransitionFindMany.mockResolvedValue([
      {
        id: 't1',
        toState: { stateKey: 'triage', name: 'Triage' },
        requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
        requiresSignature: false,
      },
      {
        id: 't2',
        toState: { stateKey: 'other', name: 'Other' },
        requiredRole: { key: 'QPPV' },
        requiresSignature: false,
      },
    ])

    const result = await service.availableTransitions('instance-1', actor)

    expect(result).toEqual([
      {
        id: 't1',
        toStateKey: 'triage',
        toStateName: 'Triage',
        requiredRoleKey: 'SUPERINTENDENT_PHARMACIST',
        requiresSignature: false,
        allowed: true,
      },
      {
        id: 't2',
        toStateKey: 'other',
        toStateName: 'Other',
        requiredRoleKey: 'QPPV',
        requiresSignature: false,
        allowed: false,
      },
    ])
  })
})

describe('WorkflowService.transition', () => {
  it('rejects with TRANSITION_NOT_ALLOWED when the target state does not exist in this workflow', async () => {
    const { service, workflowStateFindFirst } = buildHarness()
    workflowStateFindFirst.mockResolvedValue(null)

    await expect(
      service.transition(actor, 'instance-1', 'nonexistent', {}, {}),
    ).rejects.toMatchObject({
      response: { code: 'TRANSITION_NOT_ALLOWED' },
    })
  })

  it('rejects with TRANSITION_NOT_ALLOWED when no transition row exists from the current state', async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst } = buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-submitted', stateKey: 'submitted' })
    workflowTransitionFindFirst.mockResolvedValue(null)

    await expect(
      service.transition(actor, 'instance-1', 'submitted', {}, {}),
    ).rejects.toMatchObject({
      response: { code: 'TRANSITION_NOT_ALLOWED' },
    })
  })

  it("rejects with ROLE_REQUIRED when the actor lacks the transition's required role", async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst } = buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-triage', stateKey: 'triage' })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: false,
      requiredRole: { key: 'QPPV' },
      fromState: { stateKey: 'intake' },
    })

    await expect(service.transition(actor, 'instance-1', 'triage', {}, {})).rejects.toMatchObject({
      response: { code: 'ROLE_REQUIRED', details: { requiredRole: 'QPPV' } },
    })
  })

  it('rejects with SIGNATURE_REQUIRED when the transition requires a signature but none was provided', async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst } = buildHarness()
    workflowStateFindFirst.mockResolvedValue({
      id: 'state-submission-ready',
      stateKey: 'submission_ready',
    })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: true,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'quality_check' },
    })

    await expect(
      service.transition(actor, 'instance-1', 'submission_ready', {}, {}),
    ).rejects.toMatchObject({
      response: { code: 'SIGNATURE_REQUIRED' },
    })
  })

  it("rejects with TRANSITION_NOT_ALLOWED (and the guard's own reason) when a registered guard disallows the transition", async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst, guardCheck } =
      buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-triage', stateKey: 'triage' })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: false,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'intake' },
    })
    guardCheck.mockResolvedValue({
      allowed: false,
      reason: 'This case needs at least one source document attached before it can leave Intake.',
    })

    await expect(service.transition(actor, 'instance-1', 'triage', {}, {})).rejects.toMatchObject({
      response: {
        code: 'TRANSITION_NOT_ALLOWED',
        message:
          'This case needs at least one source document attached before it can leave Intake.',
      },
    })
    expect(guardCheck).toHaveBeenCalledWith(
      'pv_case',
      'intake',
      expect.objectContaining({ companyId: 'company-1', recordId: 'record-1' }),
    )
  })

  it('checks a registered guard before the signature requirement, but a passing guard still lets a signature-gated transition through to that check', async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst, guardCheck } =
      buildHarness()
    workflowStateFindFirst.mockResolvedValue({
      id: 'state-submission-ready',
      stateKey: 'submission_ready',
    })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: true,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'quality_check' },
    })
    guardCheck.mockResolvedValue({ allowed: true })

    await expect(
      service.transition(actor, 'instance-1', 'submission_ready', {}, {}),
    ).rejects.toMatchObject({
      response: { code: 'SIGNATURE_REQUIRED' },
    })
    expect(guardCheck).toHaveBeenCalled()
  })

  it("on success: updates state, bumps version, audits state_change, and syncs the domain record's own status column, all inside the same transaction", async () => {
    const {
      service,
      workflowStateFindFirst,
      workflowTransitionFindFirst,
      workflowInstanceUpdate,
      auditLog,
      statusSync,
    } = buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-triage', stateKey: 'triage' })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: false,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'intake' },
    })

    const updated = await service.transition(actor, 'instance-1', 'triage', {}, { ip: '10.0.0.1' })

    expect(workflowInstanceUpdate).toHaveBeenCalledWith({
      where: { id: 'instance-1' },
      data: {
        currentStateId: 'state-triage',
        enteredAt: expect.any(Date),
        version: { increment: 1 },
      },
    })
    expect(updated.currentStateId).toBe('state-triage')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'state_change',
        oldValue: { stateKey: 'intake' },
        newValue: { stateKey: 'triage' },
        ip: '10.0.0.1',
      }),
    )
    // Real-usage bug bash, 16 Aug 2026 — `Case.status`/`Signal.status` were
    // never written after creation; this is the fix.
    expect(statusSync).toHaveBeenCalledWith('pv_case', {
      tx: expect.anything(),
      recordId: 'record-1',
      toStateKey: 'triage',
      companyId: 'company-1',
      actorUserId: 'user-1',
      payload: undefined,
    })
  })

  it('RegCloud Stage 6: passes an optional payload through to the guard context and the status-sync context, but omits it when absent — zero behavior change for every existing transition that never passes one', async () => {
    const {
      service,
      workflowStateFindFirst,
      workflowTransitionFindFirst,
      auditLog,
      guardCheck,
      statusSync,
    } = buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-triage', stateKey: 'triage' })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: false,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'intake' },
    })

    await service.transition(
      actor,
      'instance-1',
      'triage',
      { payload: { registrationNumber: 'PPB-2026-0001' } },
      {},
    )
    expect(guardCheck).toHaveBeenCalledWith(
      'pv_case',
      'intake',
      expect.objectContaining({ payload: { registrationNumber: 'PPB-2026-0001' } }),
    )
    expect(statusSync).toHaveBeenCalledWith(
      'pv_case',
      expect.objectContaining({ payload: { registrationNumber: 'PPB-2026-0001' } }),
    )

    guardCheck.mockClear()
    statusSync.mockClear()
    auditLog.mockClear()
    await service.transition(actor, 'instance-1', 'triage', {}, {})
    expect(guardCheck).toHaveBeenCalledWith(
      'pv_case',
      'intake',
      expect.objectContaining({ payload: undefined }),
    )
    expect(statusSync).toHaveBeenCalledWith(
      'pv_case',
      expect.objectContaining({ payload: undefined }),
    )
    // The audit entry's own newValue shape is completely unaffected by payload — it was never threaded there, only note is.
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ newValue: { stateKey: 'triage' } }),
    )
  })

  it('VigiCloud Stage 17: passes an optional note through to the guard context and into the audit entry, but omits it from both when absent', async () => {
    const { service, workflowStateFindFirst, workflowTransitionFindFirst, auditLog, guardCheck } =
      buildHarness()
    workflowStateFindFirst.mockResolvedValue({ id: 'state-triage', stateKey: 'triage' })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: false,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'intake' },
    })

    await service.transition(
      actor,
      'instance-1',
      'triage',
      { note: 'Rationale for this specific move.' },
      {},
    )
    expect(guardCheck).toHaveBeenCalledWith(
      'pv_case',
      'intake',
      expect.objectContaining({ note: 'Rationale for this specific move.' }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        newValue: { stateKey: 'triage', note: 'Rationale for this specific move.' },
      }),
    )

    auditLog.mockClear()
    guardCheck.mockClear()
    await service.transition(actor, 'instance-1', 'triage', {}, {})
    expect(guardCheck).toHaveBeenCalledWith(
      'pv_case',
      'intake',
      expect.objectContaining({ note: undefined }),
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ newValue: { stateKey: 'triage' } }),
    )
  })

  it('on a signature-gated success: calls SignatureService.sign with the canonical transition payload and records the signatureEventId', async () => {
    const { service, sign, workflowStateFindFirst, workflowTransitionFindFirst, auditLog } =
      buildHarness()
    workflowStateFindFirst.mockResolvedValue({
      id: 'state-submission-ready',
      stateKey: 'submission_ready',
    })
    workflowTransitionFindFirst.mockResolvedValue({
      id: 't1',
      requiresSignature: true,
      requiredRole: { key: 'SUPERINTENDENT_PHARMACIST' },
      fromState: { stateKey: 'quality_check' },
    })

    await service.transition(
      actor,
      'instance-1',
      'submission_ready',
      { signatureToken: 'tok-1', intentStatement: 'I approve' },
      {},
    )

    expect(sign).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({
        recordType: 'pv_case',
        recordId: 'record-1',
        intentStatement: 'I approve',
        signatureToken: 'tok-1',
        roleAtSigning: 'SUPERINTENDENT_PHARMACIST',
        canonicalPayload: expect.objectContaining({
          fromStateKey: 'quality_check',
          toStateKey: 'submission_ready',
        }),
      }),
      {},
    )
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ newValue: expect.objectContaining({ signatureEventId: 'sig-1' }) }),
    )
  })

  it('404s when the instance does not exist (row-lock query returns no rows)', async () => {
    const { service, queryRaw } = buildHarness()
    queryRaw.mockResolvedValue([])

    await expect(service.transition(actor, 'missing', 'triage', {}, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})
