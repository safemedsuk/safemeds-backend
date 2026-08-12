import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import type { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'

import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../../common/rls/rls.service'
import { EnvConfig } from '../../../config/env.validation'
import { SessionActivityService } from '../services/session-activity.service'

function cookieExtractor(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined
  return cookies?.access_token ?? null
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<EnvConfig, true>,
    private readonly rls: RlsService,
    private readonly sessionActivityService: SessionActivityService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      secretOrKey: configService.get('JWT_ACCESS_SECRET', { infer: true }),
      ignoreExpiration: false,
    })
  }

  /**
   * Runs on every authenticated request. This is deliberately an
   * independent re-check against the DB (not a trust of the JWT's own
   * claims) — `runWithSystemAccess` because verifying a token's claims
   * against current state can't itself presuppose those claims are
   * correct (that's what it's checking).
   */
  async validate(payload: AuthenticatedUser): Promise<AuthenticatedUser> {
    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUnique({ where: { id: payload.sub } }),
    )

    if (!user || user.status !== 'active' || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Session is no longer valid',
      })
    }

    // Stage 0.7 — fire-and-forget; never blocks or fails this request.
    this.sessionActivityService.touch(payload.sub)

    return payload
  }
}
