import { TransitionGuardFn } from '../workflow/workflow-guard-registry.service'
import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { RECALL_RECORD_TYPE } from './recall.service'
import { RecallWorkflowGuards } from './recall-workflow-guards.service'

function buildHarness() {
  const guardRegister = jest.fn()
  const guardRegistry = { register: guardRegister } as never

  const statusSyncRegister = jest.fn()
  const statusSyncRegistry = { register: statusSyncRegister } as never

  new RecallWorkflowGuards(guardRegistry, statusSyncRegistry).onModuleInit()

  return { guardRegister, statusSyncRegister }
}

describe('RecallWorkflowGuards', () => {
  it('registers exactly one guard, on the in_progress state', () => {
    const { guardRegister } = buildHarness()
    expect(guardRegister).toHaveBeenCalledTimes(1)
    expect(guardRegister).toHaveBeenCalledWith(
      RECALL_RECORD_TYPE,
      'in_progress',
      expect.any(Function),
    )
  })

  it('registers a status-sync function', () => {
    const { statusSyncRegister } = buildHarness()
    expect(statusSyncRegister).toHaveBeenCalledWith(RECALL_RECORD_TYPE, expect.any(Function))
  })

  describe('closure reason backstop', () => {
    it('ignores a toStateKey other than closed', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn

      const result = await guard({
        tx: {} as never,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'somewhere_else',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
    })

    it('disallows closing when no reason is on record', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn
      const findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'recall-1', reason: '  ' })
      const tx = { recall: { findUniqueOrThrow } } as never

      const result = await guard({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'closed',
        actorUserId: 'user-1',
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/reason must be on record/i)
    })

    it('allows closing once a real reason is on record', async () => {
      const { guardRegister } = buildHarness()
      const guard = guardRegister.mock.calls[0][2] as TransitionGuardFn
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ id: 'recall-1', reason: 'Contamination detected' })
      const tx = { recall: { findUniqueOrThrow } } as never

      const result = await guard({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'closed',
        actorUserId: 'user-1',
      })
      expect(result).toEqual({ allowed: true })
    })
  })

  describe('status sync', () => {
    it('keeps Recall.status in sync on an ordinary transition', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { recall: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'investigating',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'recall-1' },
        data: { status: 'investigating' },
      })
    })

    it('also stamps authorityNotifiedAt when entering notified_to_authority', async () => {
      const { statusSyncRegister } = buildHarness()
      const sync = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
      const update = jest.fn().mockResolvedValue({})
      const tx = { recall: { update } } as never

      await sync({
        tx,
        companyId: 'company-1',
        recordId: 'recall-1',
        toStateKey: 'notified_to_authority',
        actorUserId: 'user-1',
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: 'recall-1' },
        data: { status: 'notified_to_authority', authorityNotifiedAt: expect.any(Date) },
      })
    })
  })
})
