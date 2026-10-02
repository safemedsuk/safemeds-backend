import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { SignalWorkflowGuards } from './signal-workflow-guards.service'

interface GuardCtx {
  tx?: unknown
  companyId?: string
  recordId?: string
  toStateKey?: string
  actorUserId?: string
  note?: string
}
type GuardFn = (ctx: GuardCtx) => Promise<{ allowed: boolean; reason?: string }>

describe('SignalWorkflowGuards', () => {
  function buildHarness(signalRow: { assessedBy: string | null } | null = null) {
    const guards = new Map<string, GuardFn[]>()
    const register = jest.fn((recordType: string, fromStateKey: string, fn: GuardFn) => {
      const key = `${recordType}:${fromStateKey}`
      guards.set(key, [...(guards.get(key) ?? []), fn])
    })
    const guardRegistry = { register } as never
    const statusSyncRegister = jest.fn()
    const statusSyncRegistry = { register: statusSyncRegister } as never
    const service = new SignalWorkflowGuards(guardRegistry, statusSyncRegistry)
    service.onModuleInit()
    const signalFindFirst = jest.fn().mockResolvedValue(signalRow)
    const tx = { signal: { findFirst: signalFindFirst } }
    return { guards, statusSyncRegister, tx, signalFindFirst }
  }

  it('registers a guard on every non-terminal signal state', () => {
    const { guards } = buildHarness()
    for (const state of [
      'detected',
      'validated',
      'confirmed',
      'analysed_prioritised',
      'assessed',
    ]) {
      expect(guards.has(`signal:${state}`)).toBe(true)
    }
  })

  it('blocks a transition with no rationale note', async () => {
    const { guards } = buildHarness()
    const guard = guards.get('signal:detected')![0]
    const result = await guard({})
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/rationale/i)
  })

  it('blocks a transition with a whitespace-only note', async () => {
    const { guards } = buildHarness()
    const guard = guards.get('signal:validated')![0]
    const result = await guard({ note: '   ' })
    expect(result.allowed).toBe(false)
  })

  it('allows a transition with a real rationale', async () => {
    const { guards } = buildHarness()
    const guard = guards.get('signal:assessed')![0]
    const result = await guard({
      note: 'Consistent pattern confirmed against MedDRA-coded terms across all linked cases.',
    })
    expect(result.allowed).toBe(true)
  })

  describe('four-eyes at recommendation (real-usage request, 22 Sep 2026, item 22)', () => {
    it('registers a second guard on signal:assessed, alongside the rationale-required one', () => {
      const { guards } = buildHarness()
      expect(guards.get('signal:assessed')).toHaveLength(2)
    })

    it('allows every transition out of assessed other than action_recommended, regardless of assessor', async () => {
      const { guards, tx } = buildHarness({ assessedBy: 'user-1' })
      const guard = guards.get('signal:assessed')![1]
      const result = await guard({ tx, recordId: 'signal-1', toStateKey: 'refuted', actorUserId: 'user-1' })
      expect(result.allowed).toBe(true)
    })

    it('blocks action_recommended when the acting user is the same one who recorded the assessment', async () => {
      const { guards, tx } = buildHarness({ assessedBy: 'user-1' })
      const guard = guards.get('signal:assessed')![1]
      const result = await guard({ tx, recordId: 'signal-1', toStateKey: 'action_recommended', actorUserId: 'user-1' })
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/cannot be the same person/i)
    })

    it('allows action_recommended when a genuinely different user recommends it', async () => {
      const { guards, tx } = buildHarness({ assessedBy: 'user-1' })
      const guard = guards.get('signal:assessed')![1]
      const result = await guard({ tx, recordId: 'signal-1', toStateKey: 'action_recommended', actorUserId: 'user-2' })
      expect(result.allowed).toBe(true)
    })

    it('allows action_recommended when the signal has no recorded assessor at all', async () => {
      const { guards, tx } = buildHarness({ assessedBy: null })
      const guard = guards.get('signal:assessed')![1]
      const result = await guard({ tx, recordId: 'signal-1', toStateKey: 'action_recommended', actorUserId: 'user-2' })
      expect(result.allowed).toBe(true)
    })
  })

  it('registers a signal status-sync function that writes Signal.status to the new state (real-usage bug bash, 16 Aug 2026)', async () => {
    const { statusSyncRegister } = buildHarness()

    expect(statusSyncRegister).toHaveBeenCalledWith('signal', expect.any(Function))

    const syncFn = statusSyncRegister.mock.calls[0][1] as StatusSyncFn
    const update = jest.fn()
    const tx = { signal: { update } } as never
    await syncFn({ tx, recordId: 'signal-1', toStateKey: 'confirmed', companyId: 'company-1' })

    expect(update).toHaveBeenCalledWith({
      where: { id: 'signal-1' },
      data: { status: 'confirmed' },
    })
  })
})
