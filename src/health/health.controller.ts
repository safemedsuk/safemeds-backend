import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus'

import { PrismaHealthIndicator } from './indicators/prisma-health.indicator'
import { RedisHealthIndicator } from './indicators/redis-health.indicator'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
  ) {}

  @Get()
  liveness(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }

  @Get('ready')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.check('database'),
      () => this.redisIndicator.check('redis'),
    ])
  }
}
