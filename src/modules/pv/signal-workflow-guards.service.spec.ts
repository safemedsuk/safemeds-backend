import { StatusSyncFn } from '../workflow/workflow-status-sync-registry.service'
import { SignalWorkflowGuards } from './signal-workflow-guards.service'

describe('SignalWorkflowGuards', () => {
  function buildHarness() {
    const guards = new Map<
      string,
      ((ctx: { note?: string }) => Promise<{ allowed: boolean; reason?: string }>)[]
    >()
    const register = jest.fn(
      (
        recordType: string,
        fromStateKey: string,
        fn: (ctx: { note?: string }) => Promise<{ allowed: boolean; reason?: string }>,
      ) => {
        const key = `${recordType}:${fromStateKey}`
        guards.set(key, [...(guards.get(key) ?? []), fn])
      },
    )
    const guardRegistry = { register } as never
    const statusSyncRegister = jest.fn()
    const statusSyncRegistry = { register: statusSyncRegister } as never
    const service = new SignalWorkflowGuards(guardRegistry, statusSyncRegistry)
    service.onModuleInit()
    return { guards, statusSyncRegister }
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
