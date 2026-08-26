import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { ReportBuilderController } from './report-builder.controller'
import { ReportBuilderService } from './report-builder.service'
import {
  REPORT_BUILDER_SCHEDULE_QUEUE,
  ReportBuilderScheduleProcessor,
} from './report-builder-schedule.processor'

const DAILY_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000

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

@Module({
  imports: [
    AuditModule,
    DocumentsModule,
    BullModule.registerQueueAsync({
      name: REPORT_BUILDER_SCHEDULE_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [ReportBuilderController],
  providers: [ReportBuilderService, ReportBuilderScheduleProcessor],
  exports: [ReportBuilderService],
})
export class ReportBuilderModule implements OnModuleInit {
  constructor(
    @InjectQueue(REPORT_BUILDER_SCHEDULE_QUEUE) private readonly scheduleQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `ReportingModule`'s identical guard for why. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.scheduleQueue.add(
      'scan',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'report-builder-schedule-daily' },
    )
  }
}
