import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { MfaPendingTokenService } from './mfa-pending-token.service'

/**
 * In-memory stand-in for RedisService — exercises the same GET/SET/DEL
 * surface `MfaPendingTokenService` actually calls, without a real Redis
 * connection. `KEEPTTL` doesn't need real TTL semantics for these
 * assertions (nothing here waits on wall-clock expiry).
 */
class FakeRedisService {
  private store = new Map<string, string>()

  client = {
    set: (key: string, value: string) => {
      this.store.set(key, value)
      return Promise.resolve('OK')
    },
    get: (key: string) => Promise.resolve(this.store.get(key) ?? null),
    del: (key: string) => Promise.resolve(this.store.delete(key) ? 1 : 0),
  }
}

function buildService() {
  const configValues: Record<string, unknown> = {
    JWT_MFA_PENDING_EXPIRES_IN_MINUTES: 5,
    JWT_MFA_PENDING_SECRET: 'test-secret-at-least-32-characters-long',
  }
  const configService = { get: (key: string) => configValues[key] } as unknown as ConfigService
  const jwtService = new JwtService({})
  const redisService = new FakeRedisService()

  const service = new MfaPendingTokenService(
    jwtService,
    configService as never,
    redisService as never,
  )
  return { service }
}

describe('MfaPendingTokenService', () => {
  it('verify() does not consume the session — a wrong code can be retried', async () => {
    const { service } = buildService()
    const token = await service.issue('user-1')

    const first = await service.verify(token)
    expect(first.userId).toBe('user-1')

    // Simulate a wrong code: the controller records a failed attempt but
    // never calls consume(). The session must still be verifiable.
    await service.recordFailedAttempt(first.jti)

    const second = await service.verify(token)
    expect(second.userId).toBe('user-1')
  })

  it('locks the session out after MAX_CHALLENGE_ATTEMPTS failures', async () => {
    const { service } = buildService()
    const token = await service.issue('user-1')
    const { jti } = await service.verify(token)

    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(jti)
    }

    await expect(service.verify(token)).rejects.toThrow(UnauthorizedException)
  })

  it('consume() permanently retires the session — a second verify() fails', async () => {
    const { service } = buildService()
    const token = await service.issue('user-1')
    const { jti } = await service.verify(token)

    await service.consume(jti)

    await expect(service.verify(token)).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a token whose signature/purpose does not check out', async () => {
    const { service } = buildService()
    await expect(service.verify('not-a-real-jwt')).rejects.toThrow(UnauthorizedException)
  })
})
