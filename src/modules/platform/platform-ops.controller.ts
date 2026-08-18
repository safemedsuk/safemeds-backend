import { InjectQueue } from '@nestjs/bullmq'
import { Controller, Get, Inject, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Queue } from 'bullmq'

import { PrismaHealthIndicator } from '../../health/indicators/prisma-health.indicator'
import { RedisHealthIndicator } from '../../health/indicators/redis-health.indicator'
import {
  NOTIFICATION_EMAIL_QUEUE,
  NotificationEmailJob,
} from '../notifications/notification-email.processor'
import { DeadlineService } from '../workflow/deadline.service'
import {
  DEADLINE_ESCALATION_NOTIFIER,
  DeadlineEscalationNotifier,
} from '../workflow/deadline-escalation.interface'
import { DEADLINE_ESCALATION_QUEUE } from '../workflow/deadline-escalation.processor'
import { PlatformOnly } from './platform-only.decorator'

async function queueCounts(queue: Queue) {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
  }
}

/**
 * Ops actions for platform staff — separate from `PlatformController`
 * (registration review) since these aren't about a specific registration.
 * `POST /platform/ops/deadline-scan` runs the exact same scan the hourly
 * BullMQ job runs, on demand — lets a real end-to-end test (task escalates
 * -> in-app notification appears -> email sends) happen in minutes instead
 * of waiting for the next scheduled hour, without touching the database
 * directly. Deliberately platform-only, not tenant-facing: it scans every
 * company's deadlines at once, not just the caller's own.
 */
@ApiTags('platform')
@Controller('platform/ops')
@PlatformOnly('super_admin')
export class PlatformOpsController {
  constructor(
    private readonly deadlineService: DeadlineService,
    @Inject(DEADLINE_ESCALATION_NOTIFIER) private readonly notifier: DeadlineEscalationNotifier,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    @InjectQueue(DEADLINE_ESCALATION_QUEUE) private readonly deadlineQueue: Queue,
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE) private readonly emailQueue: Queue<NotificationEmailJob>,
  ) {}

  @Post('deadline-scan')
  async runDeadlineScan() {
    const result = await this.deadlineService.scanAndEscalate(this.notifier)
    return result
  }

  @Get('system-health')
  async systemHealth() {
    const [database, redis, deadlineEscalation, notificationEmail] = await Promise.all([
      this.prismaIndicator.check('database'),
      this.redisIndicator.check('redis'),
      queueCounts(this.deadlineQueue),
      queueCounts(this.emailQueue),
    ])

    return {
      database: database.database,
      redis: redis.redis,
      queues: { deadlineEscalation, notificationEmail },
    }
  }
}
