import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EntitlementsService } from './entitlements.service'
import { ENTITLEMENT_KEY, RequiredEntitlement } from './require-entitlement.decorator'

type RequestWithUser = Request & { user?: AuthenticatedUser }

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredEntitlement>(ENTITLEMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!required) {
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>()
    const user = request.user

    if (!user?.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No company context for this account',
      })
    }

    const enabled = await this.entitlementsService.isEnabled(
      user.companyId,
      required.moduleKey,
      required.featureKey,
    )
    if (!enabled) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: `The "${required.moduleKey}" module is not enabled for your company`,
      })
    }

    return true
  }
}
