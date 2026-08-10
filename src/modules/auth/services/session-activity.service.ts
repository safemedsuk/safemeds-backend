import { Injectable, Logger } from '@nestjs/common'

import { RedisService } from '../../../common/redis/redis.service'

const REDIS_KEY_PREFIX = 'session-activity:'
/** Generous cleanup TTL, well past any realistic idle-timeout policy value — just housekeeping, not the enforcement itself. */
const KEY_TTL_SECONDS = 24 * 60 * 60

/**
 * VigiCloud Stage 0.7 — the backend backstop half of the 5-minute
 * inactivity timeout ("especially for patient data"). The *primary*
 * enforcement is the frontend's own idle timer, which logs a user out
 * client-side the moment it fires — this service exists for the case
 * where that never happens (a stale background tab, a client that
 * skipped the timer entirely): `SessionService.refresh()` checks it
 * before honouring a refresh request.
 *
 * Keyed by user id, not by individual session/device — a deliberate
 * simplification. The access-token payload carries no per-session
 * identifier (no `familyId`), so tracking idle time per-device would
 * mean adding one — a bigger change than this backstop needs. In
 * practice this means one very active session keeps a user's *other*
 * idle sessions looking "recently active" too; that's an acceptable
 * trade for a defense-in-depth check, not the actual security boundary.
 *
 * Fire-and-forget by design: `touch()` is called on essentially every
 * authenticated request (see `JwtStrategy.validate()`), so it must never
 * block the request or fail it if Redis hiccups.
 */
@Injectable()
export class SessionActivityService {
  private readonly logger = new Logger(SessionActivityService.name)

  constructor(private readonly redisService: RedisService) {}

  touch(userId: string): void {
    this.redisService.client
      .set(`${REDIS_KEY_PREFIX}${userId}`, Date.now().toString(), 'EX', KEY_TTL_SECONDS)
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to record session activity for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  /** Minutes since the last recorded activity, or `null` if there's no signal at all (never touched, or the key expired/Redis was unavailable) — callers should fail open on `null`, not treat it as "idle forever." */
  async idleMinutesSince(userId: string): Promise<number | null> {
    const raw = await this.redisService.client.get(`${REDIS_KEY_PREFIX}${userId}`)
    if (!raw) return null

    const lastActivityMs = Number(raw)
    if (!Number.isFinite(lastActivityMs)) return null

    return (Date.now() - lastActivityMs) / (60 * 1000)
  }
}
