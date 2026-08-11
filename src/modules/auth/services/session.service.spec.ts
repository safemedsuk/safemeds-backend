import { UnauthorizedException } from '@nestjs/common'
import { User } from '@prisma/client'

import { SessionService } from './session.service'

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    companyId: 'company-1',
    email: 'test@example.com',
    fullName: 'Test User',
    passwordHash: 'x',
    status: 'active',
    platformRole: null,
    roleKeys: [],
    isExternal: false,
    mustChangePassword: false,
    tokenVersion: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildHarness(opts: { idleMinutes: number | null; sessionTimeoutMinutes: number | null }) {
  const revokeFamily = jest.fn().mockResolvedValue(undefined)
  const rotate = jest.fn()
  const tokenService = { rotate, revokeFamily, signAccessToken: jest.fn() } as never

  const touch = jest.fn()
  const idleMinutesSince = jest.fn().mockResolvedValue(opts.idleMinutes)
  const sessionActivityService = { touch, idleMinutesSince } as never

  const securityPolicy =
    opts.sessionTimeoutMinutes === null
      ? null
      : { sessionTimeoutMinutes: opts.sessionTimeoutMinutes }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: unknown) => unknown) =>
      fn({ securityPolicy: { findUnique: jest.fn().mockResolvedValue(securityPolicy) } }),
  }

  const service = new SessionService(
    {} as never, // prisma — unused by refresh()
    rls as never,
    {} as never, // configService — unused by refresh()
    {} as never, // passwordService
    tokenService,
    { log: jest.fn() } as never, // auditService
    {} as never, // mfaPendingTokenService
    sessionActivityService,
  )

  return { service, revokeFamily, rotate, touch, idleMinutesSince }
}

describe('SessionService.refresh() — Stage 0.7 idle timeout', () => {
  const meta = { ip: '127.0.0.1', userAgent: 'test-agent' }

  it('allows the refresh and touches activity when there is no idle signal at all (fail open)', async () => {
    const { service, rotate, revokeFamily, touch } = buildHarness({
      idleMinutes: null,
      sessionTimeoutMinutes: 5,
    })
    rotate.mockResolvedValue({
      user: buildUser(),
      accessToken: 'a',
      refreshToken: { plaintext: 'p', familyId: 'family-1', expiresAt: new Date() },
    })

    const result = await service.refresh('plaintext-token', meta)

    expect(result.accessToken).toBe('a')
    expect(revokeFamily).not.toHaveBeenCalled()
    expect(touch).toHaveBeenCalledWith('user-1')
  })

  it('allows the refresh when idle time is within the company policy window', async () => {
    const { service, rotate, revokeFamily } = buildHarness({
      idleMinutes: 3,
      sessionTimeoutMinutes: 5,
    })
    rotate.mockResolvedValue({
      user: buildUser(),
      accessToken: 'a',
      refreshToken: { plaintext: 'p', familyId: 'family-1', expiresAt: new Date() },
    })

    await service.refresh('plaintext-token', meta)

    expect(revokeFamily).not.toHaveBeenCalled()
  })

  it('rejects the refresh and revokes the family when idle time exceeds the company policy window', async () => {
    const { service, rotate, revokeFamily } = buildHarness({
      idleMinutes: 12,
      sessionTimeoutMinutes: 5,
    })
    rotate.mockResolvedValue({
      user: buildUser(),
      accessToken: 'a',
      refreshToken: { plaintext: 'p', familyId: 'family-1', expiresAt: new Date() },
    })

    await expect(service.refresh('plaintext-token', meta)).rejects.toThrow(UnauthorizedException)
    expect(revokeFamily).toHaveBeenCalledWith('family-1')
  })

  it('uses the fixed 5-minute platform-staff default when the actor has no company (and thus no SecurityPolicy)', async () => {
    const { service, rotate, revokeFamily } = buildHarness({
      idleMinutes: 6,
      sessionTimeoutMinutes: null,
    })
    rotate.mockResolvedValue({
      user: buildUser({ companyId: null, platformRole: 'super_admin' }),
      accessToken: 'a',
      refreshToken: { plaintext: 'p', familyId: 'family-1', expiresAt: new Date() },
    })

    await expect(service.refresh('plaintext-token', meta)).rejects.toThrow(UnauthorizedException)
    expect(revokeFamily).toHaveBeenCalledWith('family-1')
  })

  it('falls back to the 5-minute default if a company somehow has no SecurityPolicy row', async () => {
    const { service, rotate, revokeFamily } = buildHarness({
      idleMinutes: 3,
      sessionTimeoutMinutes: null,
    })
    rotate.mockResolvedValue({
      user: buildUser(),
      accessToken: 'a',
      refreshToken: { plaintext: 'p', familyId: 'family-1', expiresAt: new Date() },
    })

    await service.refresh('plaintext-token', meta)

    expect(revokeFamily).not.toHaveBeenCalled()
  })
})
