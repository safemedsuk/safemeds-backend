import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { RolesService } from '../../modules/roles/roles.service'
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface'

type RequestWithUser = Request & { user?: AuthenticatedUser }

/**
 * Registered globally (APP_GUARD, after JwtAuthGuard so `request.user` is
 * populated). No-ops unless the handler carries `@RequirePermissions()`
 * metadata — same opt-in shape as `@Public()`/`CsrfGuard`. When present,
 * resolves the caller's roles to a permission set via `RolesService` and
 * requires every listed permission.
 *
 * "cached per-request": a request re-entering this guard (defensive —
 * NestJS runs each route's guards once per request today) reuses the same
 * in-flight resolution rather than re-querying.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly cache = new WeakMap<Request, Promise<Set<string>>>()

  constructor(
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!required || required.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const user = request.user

    if (!user) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Authentication required' })
    }

    let pending = this.cache.get(request)
    if (!pending) {
      pending = this.rolesService.getPermissionsForUser(user)
      this.cache.set(request, pending)
    }

    const granted = await pending
    const missing = required.filter((permission) => !granted.has(permission))

    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to perform this action',
        details: { missing },
      })
    }

    return true
  }
}
