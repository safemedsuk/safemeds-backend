import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'

import { EnvConfig } from '../../config/env.validation'

const ATOMIC_GETDEL_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`

/**
 * Shared Redis client for anything that needs fast, TTL-based single-use
 * storage outside Postgres — signature-grade token jtis (Phase 1.9) and
 * mfa_pending jtis (Phase 1.6) today, BullMQ (Phase 5/9) later. A single
 * connection reused app-wide rather than each feature opening its own.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.client = new Redis(configService.get('REDIS_URL', { infer: true }))
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }

  /**
   * Atomic get-and-delete. `GETDEL` only exists from Redis 6.2 — this Lua
   * script gets the same single round-trip atomicity on any Redis version,
   * which matters here (target deployments and some dev/CI environments
   * still run 6.0.x).
   */
  async getdel(key: string): Promise<string | null> {
    return this.client.eval(ATOMIC_GETDEL_SCRIPT, 1, key) as Promise<string | null>
  }
}
