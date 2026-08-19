import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PLATFORM_ROLES_KEY } from './platform-only.decorator'

type RequestWithUser = Request & { user?: AuthenticatedUser }

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const user = request.user

    if (!user?.platformRole) {
      throw new ForbiddenException({ code: 'PLATFORM_ONLY', message: 'Platform staff only' })
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.platformRole)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient platform role' })
    }

    return true
  }
}
