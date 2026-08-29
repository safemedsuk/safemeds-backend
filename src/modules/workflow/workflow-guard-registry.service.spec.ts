import { WorkflowGuardRegistryService } from './workflow-guard-registry.service'

const ctx = {
  tx: {} as never,
  companyId: 'company-1',
  recordId: 'record-1',
  toStateKey: 'triage',
  actorUserId: 'user-1',
}

describe('WorkflowGuardRegistryService', () => {
  it('allows a transition with no registered guards', async () => {
    const registry = new WorkflowGuardRegistryService()
    await expect(registry.check('pv_case', 'intake', ctx)).resolves.toEqual({ allowed: true })
  })

  it('runs a registered guard and returns its disallow result', async () => {
    const registry = new WorkflowGuardRegistryService()
    registry.register(
      'pv_case',
      'intake',
      jest.fn().mockResolvedValue({ allowed: false, reason: 'needs a source document' }),
    )

    await expect(registry.check('pv_case', 'intake', ctx)).resolves.toEqual({
      allowed: false,
      reason: 'needs a source document',
    })
  })

  it('only checks guards registered for the exact (recordType, fromStateKey) pair', async () => {
    const registry = new WorkflowGuardRegistryService()
    registry.register(
      'pv_case',
      'triage',
      jest.fn().mockResolvedValue({ allowed: false, reason: 'wrong state' }),
    )
    registry.register(
      'deviation',
      'intake',
      jest.fn().mockResolvedValue({ allowed: false, reason: 'wrong record type' }),
    )

    await expect(registry.check('pv_case', 'intake', ctx)).resolves.toEqual({ allowed: true })
  })

  it('runs multiple guards for the same pair in registration order and stops at the first disallow', async () => {
    const registry = new WorkflowGuardRegistryService()
    const calls: string[] = []
    registry.register('pv_case', 'intake', () => {
      calls.push('first')
      return Promise.resolve({ allowed: true })
    })
    registry.register('pv_case', 'intake', () => {
      calls.push('second')
      return Promise.resolve({ allowed: false, reason: 'second guard blocks it' })
    })
    registry.register('pv_case', 'intake', () => {
      calls.push('third')
      return Promise.resolve({ allowed: true })
    })

    const result = await registry.check('pv_case', 'intake', ctx)

    expect(result).toEqual({ allowed: false, reason: 'second guard blocks it' })
    expect(calls).toEqual(['first', 'second'])
  })

  it('passes the exact context object through to the guard function', async () => {
    const registry = new WorkflowGuardRegistryService()
    const guard = jest.fn().mockResolvedValue({ allowed: true })
    registry.register('pv_case', 'intake', guard)

    await registry.check('pv_case', 'intake', ctx)

    expect(guard).toHaveBeenCalledWith(ctx)
  })
})
