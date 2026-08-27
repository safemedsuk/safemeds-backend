import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { TasksModule } from '../tasks/tasks.module'
import { SdeaController } from './sdea.controller'
import { SdeaService } from './sdea.service'
import {
  SDEA_RENEWAL_REMINDER_QUEUE,
  SdeaRenewalReminderProcessor,
} from './sdea-renewal-reminder.processor'
import { SdeaRenewalReminderService } from './sdea-renewal-reminder.service'

function redisConnectionFactory(configService: ConfigService<EnvConfig, true>) {
  const url = new URL(configService.get('REDIS_URL', { infer: true }))
  return {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    },
  }
}

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000

@Module({
  imports: [
    AuditModule,
    TasksModule,
    BullModule.registerQueueAsync({
      name: SDEA_RENEWAL_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [SdeaController],
  providers: [SdeaService, SdeaRenewalReminderService, SdeaRenewalReminderProcessor],
  exports: [SdeaService],
})
export class SdeaModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectQueue(SDEA_RENEWAL_REMINDER_QUEUE) private readonly reminderQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.reminderQueue.add(
      'scan',
      {},
      { repeat: { every: WEEKLY_MS }, jobId: 'sdea-renewal-reminder-weekly' },
    )
  }
}
