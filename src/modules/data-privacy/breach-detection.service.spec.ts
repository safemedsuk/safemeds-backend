import { BreachDetectionService } from './breach-detection.service'

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const rls = { runWithSystemAccess: (fn: (tx: unknown) => unknown) => fn({}) }

  const service = new BreachDetectionService(rls as never, auditService)
  return { service, auditLog }
}

describe('BreachDetectionService', () => {
  it('flagAnomalousAccess() writes a system-actor audit entry with the reason', async () => {
    const { service, auditLog } = buildHarness()

    await service.flagAnomalousAccess({
      actorUserId: 'user-1',
      reason: 'repeated 404s across companies',
      details: { count: 12 },
    })

    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: 'user-1',
        actorType: 'system',
        action: 'anomalous_access_flagged',
        recordType: 'system',
        newValue: expect.objectContaining({ reason: 'repeated 404s across companies', count: 12 }),
      }),
    )
  })

  it('works with no actorUserId (an unauthenticated-side anomaly)', async () => {
    const { service, auditLog } = buildHarness()
    await service.flagAnomalousAccess({ reason: 'burst of failed logins' })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorUserId: null }),
    )
  })
})
