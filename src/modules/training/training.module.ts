import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { TasksModule } from '../tasks/tasks.module'
import { TrainingRecordController } from './training-record.controller'
import { TrainingRecordService } from './training-record.service'
import { TRAINING_REMINDER_QUEUE, TrainingReminderProcessor } from './training-reminder.processor'
import { TrainingReminderService } from './training-reminder.service'
import { TrainingTypeController } from './training-type.controller'
import { TrainingTypeService } from './training-type.service'

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
      name: TRAINING_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [TrainingRecordController, TrainingTypeController],
  providers: [
    TrainingRecordService,
    TrainingReminderService,
    TrainingReminderProcessor,
    TrainingTypeService,
  ],
  exports: [TrainingRecordService],
})
export class TrainingModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectQueue(TRAINING_REMINDER_QUEUE) private readonly reminderQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.reminderQueue.add(
      'scan',
      {},
      { repeat: { every: WEEKLY_MS }, jobId: 'training-reminder-weekly' },
    )
  }
}
