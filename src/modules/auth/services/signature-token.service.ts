import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { newId } from '../../../common/id'
import { RedisService } from '../../../common/redis/redis.service'
import { EnvConfig } from '../../../config/env.validation'

const REDIS_KEY_PREFIX = 'signature-token:'

interface SignatureTokenPayload {
  sub: string
  jti: string
  purpose: 'signature'
}

/**
 * Phase 1.9 re-authentication tokens: 5-minute, single-use, scoped to
 * `purpose: signature`. This is the only token the future signature
 * service (Phase 6) will accept. Single-use is enforced via Redis
 * (GETDEL is atomic) rather than Postgres — these are short-lived and
 * high-frequency, a DB row per token would be pure overhead.
 */
@Injectable()
export class SignatureTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly redisService: RedisService,
  ) {}

  async issue(userId: string): Promise<string> {
    const jti = newId()
    const ttlSeconds =
      this.configService.get('REAUTH_TOKEN_EXPIRES_IN_MINUTES', { infer: true }) * 60

    await this.redisService.client.set(`${REDIS_KEY_PREFIX}${jti}`, userId, 'EX', ttlSeconds)

    return this.jwtService.sign(
      { sub: userId, jti, purpose: 'signature' } satisfies SignatureTokenPayload,
      {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: `${ttlSeconds}s`,
      },
    )
  }

  /** Verifies and consumes a signature-grade token for the given user. Throws on any failure. */
  async consume(token: string, expectedUserId: string): Promise<void> {
    let payload: SignatureTokenPayload

    try {
      payload = this.jwtService.verify<SignatureTokenPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      })
    } catch {
      throw new UnauthorizedException({
        code: 'SIGNATURE_TOKEN_INVALID',
        message: 'Invalid or expired signature token',
      })
    }

    if (payload.purpose !== 'signature' || payload.sub !== expectedUserId) {
      throw new UnauthorizedException({
        code: 'SIGNATURE_TOKEN_INVALID',
        message: 'Invalid signature token',
      })
    }

    const storedUserId = await this.redisService.getdel(`${REDIS_KEY_PREFIX}${payload.jti}`)

    if (storedUserId !== expectedUserId) {
      throw new UnauthorizedException({
        code: 'SIGNATURE_TOKEN_INVALID',
        message: 'Signature token already used or expired',
      })
    }
  }
}
