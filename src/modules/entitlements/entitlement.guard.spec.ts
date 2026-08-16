import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EntitlementGuard } from './entitlement.guard'
import { EntitlementsService } from './entitlements.service'

function buildContext(user: AuthenticatedUser | undefined): ExecutionContext {
  const request = { user }
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('EntitlementGuard', () => {
  const user: AuthenticatedUser = {
    sub: 'user-1',
    companyId: 'company-1',
    roleKeys: ['SYSTEM_ADMINISTRATOR'],
    platformRole: null,
    tokenVersion: 0,
  }

  function buildGuard(getAllAndOverride: jest.Mock, isEnabled: jest.Mock) {
    const reflector = { getAllAndOverride } as unknown as Reflector
    const entitlementsService = { isEnabled } as unknown as EntitlementsService
    return new EntitlementGuard(reflector, entitlementsService)
  }

  it('allows the request through when the handler has no @RequireEntitlement metadata', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(undefined)
    const isEnabled = jest.fn()
    const guard = buildGuard(getAllAndOverride, isEnabled)

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true)
    expect(isEnabled).not.toHaveBeenCalled()
  })

  it('allows the request when the company has the required entitlement enabled', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue({ moduleKey: 'vigicloud', featureKey: '*' })
    const isEnabled = jest.fn().mockResolvedValue(true)
    const guard = buildGuard(getAllAndOverride, isEnabled)

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true)
    expect(isEnabled).toHaveBeenCalledWith('company-1', 'vigicloud', '*')
  })

  it('rejects with ForbiddenException(MODULE_NOT_ENABLED) when the entitlement is missing', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue({ moduleKey: 'vigicloud', featureKey: '*' })
    const isEnabled = jest.fn().mockResolvedValue(false)
    const guard = buildGuard(getAllAndOverride, isEnabled)

    await expect(guard.canActivate(buildContext(user))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects when there is no company context at all (platform staff)', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue({ moduleKey: 'vigicloud', featureKey: '*' })
    const isEnabled = jest.fn()
    const guard = buildGuard(getAllAndOverride, isEnabled)

    const platformUser: AuthenticatedUser = {
      sub: 'staff-1',
      companyId: null,
      roleKeys: [],
      platformRole: 'super_admin',
      tokenVersion: 0,
    }
    await expect(guard.canActivate(buildContext(platformUser))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(isEnabled).not.toHaveBeenCalled()
  })
})
