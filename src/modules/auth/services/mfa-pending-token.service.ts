import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { newId } from '../../../common/id'
import { RedisService } from '../../../common/redis/redis.service'
import { EnvConfig } from '../../../config/env.validation'

const REDIS_KEY_PREFIX = 'mfa-pending:'

/**
 * A wrong/mistimed code shouldn't burn the whole login — but the 6-digit
 * guess space still needs a bound. 5 tries inside the token's TTL window
 * is generous for a fumbling human, tight for anyone actually guessing.
 */
const MAX_CHALLENGE_ATTEMPTS = 5

interface MfaPendingPayload {
  sub: string
  jti: string
  purpose: 'mfa_pending'
}

interface RedisRecord {
  userId: string
  attempts: number
}

export interface MfaPendingSession {
  userId: string
  jti: string
}

/**
 * Step-2-of-login token: issued once password verification succeeds for a
 * user with active MFA, consumed by `POST /auth/mfa/challenge`.
 *
 * Originally this was single-use via Redis GETDEL, consumed *before* the
 * submitted code was even checked — so any one failed attempt (a typo, or
 * the authenticator app's code rotating mid-type) silently burned the
 * whole login session and bounced the user back to a fresh
 * email+password login with no explanation. Fixed: `verify()` only reads
 * the session (non-destructively) so a wrong code can be retried;
 * `recordFailedAttempt()` counts failures and locks the session out after
 * `MAX_CHALLENGE_ATTEMPTS`; `consume()` is only called once the code
 * actually validates.
 */
@Injectable()
export class MfaPendingTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly redisService: RedisService,
  ) {}

  /** Seconds remaining on the pending-token TTL, for the FE countdown. */
  get ttlSeconds(): number {
    return this.configService.get('JWT_MFA_PENDING_EXPIRES_IN_MINUTES', { infer: true }) * 60
  }

  async issue(userId: string): Promise<string> {
    const jti = newId()
    const record: RedisRecord = { userId, attempts: 0 }

    await this.redisService.client.set(
      `${REDIS_KEY_PREFIX}${jti}`,
      JSON.stringify(record),
      'EX',
      this.ttlSeconds,
    )

    return this.jwtService.sign(
      { sub: userId, jti, purpose: 'mfa_pending' } satisfies MfaPendingPayload,
      {
        secret: this.configService.get('JWT_MFA_PENDING_SECRET', { infer: true }),
        expiresIn: `${this.ttlSeconds}s`,
      },
    )
  }

  /** Verifies a still-live mfa_pending session WITHOUT consuming it, so a failed code can be retried. */
  async verify(token: string): Promise<MfaPendingSession> {
    const payload = this.verifyJwt(token)
    const record = await this.readRecord(payload.jti)

    if (!record || record.userId !== payload.sub) {
      throw new UnauthorizedException({
        code: 'MFA_PENDING_TOKEN_INVALID',
        message: 'This MFA challenge session has expired. Please log in again.',
      })
    }

    if (record.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await this.redisService.client.del(`${REDIS_KEY_PREFIX}${payload.jti}`)
      throw new UnauthorizedException({
        code: 'MFA_PENDING_TOKEN_INVALID',
        message: 'Too many incorrect codes. Please log in again.',
      })
    }

    return { userId: record.userId, jti: payload.jti }
  }

  /** Call after a wrong code/recovery code — increments the attempt count without shortening the TTL. Returns attempts remaining, for the FE. */
  async recordFailedAttempt(jti: string): Promise<number> {
    const key = `${REDIS_KEY_PREFIX}${jti}`
    const record = await this.readRecord(jti)
    if (!record) return 0

    const updated: RedisRecord = { ...record, attempts: record.attempts + 1 }
    await this.redisService.client.set(key, JSON.stringify(updated), 'KEEPTTL')
    return Math.max(0, MAX_CHALLENGE_ATTEMPTS - updated.attempts)
  }

  /** Call once the code has actually validated — permanently retires the session. */
  async consume(jti: string): Promise<void> {
    await this.redisService.client.del(`${REDIS_KEY_PREFIX}${jti}`)
  }

  private verifyJwt(token: string): MfaPendingPayload {
    let payload: MfaPendingPayload
    try {
      payload = this.jwtService.verify<MfaPendingPayload>(token, {
        secret: this.configService.get('JWT_MFA_PENDING_SECRET', { infer: true }),
      })
    } catch {
      throw new UnauthorizedException({
        code: 'MFA_PENDING_TOKEN_INVALID',
        message: 'Invalid or expired MFA challenge session. Please log in again.',
      })
    }

    if (payload.purpose !== 'mfa_pending') {
      throw new UnauthorizedException({
        code: 'MFA_PENDING_TOKEN_INVALID',
        message: 'Invalid MFA challenge session',
      })
    }

    return payload
  }

  private async readRecord(jti: string): Promise<RedisRecord | null> {
    const raw = await this.redisService.client.get(`${REDIS_KEY_PREFIX}${jti}`)
    return raw ? (JSON.parse(raw) as RedisRecord) : null
  }
}
