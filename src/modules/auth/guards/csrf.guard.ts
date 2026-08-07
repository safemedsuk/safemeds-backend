import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Double-submit CSRF check: the `csrf` cookie (readable, set at login) must
 * match the `X-CSRF-Token` header on every state-changing request. Skipped
 * for safe methods and @Public() routes, which by definition have no
 * session cookie yet to protect.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    const request = context.switchToHttp().getRequest<Request>()

    if (isPublic || SAFE_METHODS.has(request.method)) {
      return true
    }

    const cookies = request.cookies as Record<string, string> | undefined
    const cookieToken = cookies?.csrf
    const headerToken = request.headers['x-csrf-token']

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException({
        code: 'CSRF_TOKEN_INVALID',
        message: 'Missing or invalid CSRF token',
      })
    }

    return true
  }
}
