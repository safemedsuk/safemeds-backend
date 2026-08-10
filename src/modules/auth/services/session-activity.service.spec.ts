import { SessionActivityService } from './session-activity.service'

function buildHarness() {
  const store = new Map<string, string>()
  const set = jest.fn().mockImplementation((key: string, value: string) => {
    store.set(key, value)
    return Promise.resolve('OK')
  })
  const get = jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null))
  const redisService = { client: { set, get } } as never

  const service = new SessionActivityService(redisService)
  return { service, store, set, get }
}

describe('SessionActivityService', () => {
  it('idleMinutesSince() returns null when the user has never been touched', async () => {
    const { service } = buildHarness()
    await expect(service.idleMinutesSince('user-1')).resolves.toBeNull()
  })

  it('touch() then idleMinutesSince() reports close to zero minutes', async () => {
    const { service } = buildHarness()
    service.touch('user-1')
    await Promise.resolve() // let the fire-and-forget write land

    const idle = await service.idleMinutesSince('user-1')
    expect(idle).not.toBeNull()
    expect(idle!).toBeLessThan(0.1)
  })

  it('reports a real elapsed duration when the recorded activity is in the past', async () => {
    const { service, store } = buildHarness()
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000
    store.set('session-activity:user-1', tenMinutesAgo.toString())

    const idle = await service.idleMinutesSince('user-1')
    expect(idle).toBeGreaterThanOrEqual(9.9)
    expect(idle).toBeLessThanOrEqual(10.1)
  })

  it('is scoped per user — touching one user does not affect another', async () => {
    const { service } = buildHarness()
    service.touch('user-1')
    await Promise.resolve()

    await expect(service.idleMinutesSince('user-2')).resolves.toBeNull()
  })

  it('touch() never throws even if the underlying Redis call rejects', () => {
    const redisService = {
      client: { set: jest.fn().mockRejectedValue(new Error('redis down')), get: jest.fn() },
    } as never
    const service = new SessionActivityService(redisService)

    expect(() => service.touch('user-1')).not.toThrow()
  })

  it('idleMinutesSince() returns null (fails open) for a corrupted, non-numeric stored value', async () => {
    const { service, store } = buildHarness()
    store.set('session-activity:user-1', 'not-a-number')

    await expect(service.idleMinutesSince('user-1')).resolves.toBeNull()
  })
})
