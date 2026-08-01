import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

import { AuthenticatedUser } from '../interfaces/authenticated-user.interface'

type RequestWithUser = Request & { user?: AuthenticatedUser }

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>()
    return request.user as AuthenticatedUser
  },
)
