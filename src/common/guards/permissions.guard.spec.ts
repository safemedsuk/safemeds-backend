import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { RolesService } from '../../modules/roles/roles.service'
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface'
import { PermissionsGuard } from './permissions.guard'

function buildContext(user: AuthenticatedUser | undefined): ExecutionContext {
  const request = { user }
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('PermissionsGuard', () => {
  const user: AuthenticatedUser = {
    sub: 'user-1',
    companyId: 'company-1',
    roleKeys: ['QPPV'],
    platformRole: null,
    tokenVersion: 0,
  }

  function buildGuard(getAllAndOverride: jest.Mock, getPermissionsForUser: jest.Mock) {
    const reflector = { getAllAndOverride } as unknown as Reflector
    const rolesService = { getPermissionsForUser } as unknown as RolesService
    return new PermissionsGuard(reflector, rolesService)
  }

  it('allows the request through when the handler has no @RequirePermissions metadata', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(undefined)
    const getPermissionsForUser = jest.fn()
    const guard = buildGuard(getAllAndOverride, getPermissionsForUser)

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true)
    expect(getPermissionsForUser).not.toHaveBeenCalled()
  })

  it('allows the request when the resolved permission set contains every required permission', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(['pv.sign_icsr'])
    const getPermissionsForUser = jest
      .fn()
      .mockResolvedValue(new Set(['pv.capture_case', 'pv.sign_icsr']))
    const guard = buildGuard(getAllAndOverride, getPermissionsForUser)

    await expect(guard.canActivate(buildContext(user))).resolves.toBe(true)
  })

  it('rejects with ForbiddenException when a required permission is missing', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(['users.invite'])
    const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(['pv.capture_case']))
    const guard = buildGuard(getAllAndOverride, getPermissionsForUser)

    await expect(guard.canActivate(buildContext(user))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects with ForbiddenException when there is no authenticated user at all', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(['users.invite'])
    const getPermissionsForUser = jest.fn()
    const guard = buildGuard(getAllAndOverride, getPermissionsForUser)

    await expect(guard.canActivate(buildContext(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(getPermissionsForUser).not.toHaveBeenCalled()
  })

  it('only resolves permissions once per request even if canActivate runs twice (per-request cache)', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(['pv.capture_case'])
    const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(['pv.capture_case']))
    const guard = buildGuard(getAllAndOverride, getPermissionsForUser)
    const context = buildContext(user)

    await guard.canActivate(context)
    await guard.canActivate(context)

    expect(getPermissionsForUser).toHaveBeenCalledTimes(1)
  })
})
