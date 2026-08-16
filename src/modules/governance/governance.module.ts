import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { TasksModule } from '../tasks/tasks.module'
import { AuditPackService } from './audit-pack.service'
import { AuditPackPdfService } from './audit-pack-pdf.service'
import { AuditReadinessService } from './audit-readiness.service'
import {
  AUDIT_READINESS_REMINDER_QUEUE,
  AuditReadinessReminderProcessor,
} from './audit-readiness-reminder.processor'
import { AuditReadinessReminderService } from './audit-readiness-reminder.service'
import { GovernanceController } from './governance.controller'
import { RequirementDefinitionAdminService } from './requirement-definition-admin.service'

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
    DocumentsModule,
    TasksModule,
    BullModule.registerQueueAsync({
      name: AUDIT_READINESS_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [GovernanceController],
  providers: [
    AuditReadinessService,
    AuditPackPdfService,
    AuditPackService,
    AuditReadinessReminderService,
    AuditReadinessReminderProcessor,
    RequirementDefinitionAdminService,
  ],
  exports: [AuditReadinessService, AuditPackService, RequirementDefinitionAdminService],
})
export class GovernanceModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService<EnvConfig, true>,
    @InjectQueue(AUDIT_READINESS_REMINDER_QUEUE) private readonly reminderQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    // Weekly cadence, same reasoning as every other reminder job in this
    // repo (Stage 2's quarterly product reminder, Stage 14's annual
    // trial-renewal reminder) — the scan itself running weekly doesn't
    // mean a company gets reminded weekly, `AuditReadinessReminderService`'s
    // own 30-day interval throttles the actual repeat cadence per company.
    await this.reminderQueue.add(
      'scan',
      {},
      { repeat: { every: WEEKLY_MS }, jobId: 'governance-audit-readiness-reminder-weekly' },
    )
  }
}
