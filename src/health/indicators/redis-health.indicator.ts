import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import { Redis } from 'ioredis'

import { EnvConfig } from '../../config/env.validation'

const CONNECTED_STATUSES = new Set(['ready', 'connect', 'connecting'])

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis

  constructor(
    configService: ConfigService<EnvConfig, true>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {
    this.client = new Redis(configService.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    })
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)

    try {
      if (!CONNECTED_STATUSES.has(this.client.status)) {
        await this.client.connect()
      }

      const pong = await this.client.ping()

      if (pong !== 'PONG') {
        return indicator.down({ message: 'Unexpected PING response' })
      }

      return indicator.up()
    } catch (error) {
      return indicator.down({ message: (error as Error).message })
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }
}
