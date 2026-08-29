import { BullModule } from '@nestjs/bullmq'
import { InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { CountryConfigModule } from '../country-config/country-config.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { SignaturesModule } from '../signatures/signatures.module'
import { TasksModule } from '../tasks/tasks.module'
import { DeadlineController } from './deadline.controller'
import { DeadlineService } from './deadline.service'
import { DEADLINE_ESCALATION_NOTIFIER } from './deadline-escalation.interface'
import {
  DEADLINE_ESCALATION_QUEUE,
  DeadlineEscalationProcessor,
} from './deadline-escalation.processor'
import { WorkflowController } from './workflow.controller'
import { WorkflowService } from './workflow.service'
import { WorkflowGuardRegistryService } from './workflow-guard-registry.service'
import { WorkflowStatusSyncRegistryService } from './workflow-status-sync-registry.service'
import { WorkflowTaskEscalationNotifier } from './workflow-task-escalation-notifier'

const ESCALATION_SCAN_INTERVAL_MS = 60 * 60 * 1000

@Module({
  imports: [
    AuditModule,
    SignaturesModule,
    CountryConfigModule,
    TasksModule,
    NotificationsModule,
    BullModule.registerQueueAsync({
      name: DEADLINE_ESCALATION_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => {
        const url = new URL(configService.get('REDIS_URL', { infer: true }))
        return {
          // Passed as *options*, not a pre-built `Redis` instance — passing
          // an already-connected client makes `@nestjs/bullmq` treat its
          // lifecycle as externally owned and never close it on shutdown,
          // which leaked a connection (Jest's e2e suite hung on exit until
          // this was fixed; the same leak would apply to real process
          // shutdowns). Options let `@nestjs/bullmq` create and own the
          // connection, closing it automatically via Nest's shutdown hooks.
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            // BullMQ's own requirement, not a workaround for anything here.
            maxRetriesPerRequest: null,
          },
        }
      },
    }),
  ],
  controllers: [WorkflowController, DeadlineController],
  providers: [
    WorkflowService,
    WorkflowGuardRegistryService,
    WorkflowStatusSyncRegistryService,
    DeadlineService,
    DeadlineEscalationProcessor,
    WorkflowTaskEscalationNotifier,
    { provide: DEADLINE_ESCALATION_NOTIFIER, useClass: WorkflowTaskEscalationNotifier },
  ],
  exports: [
    WorkflowService,
    WorkflowGuardRegistryService,
    WorkflowStatusSyncRegistryService,
    DeadlineService,
    DEADLINE_ESCALATION_NOTIFIER,
    BullModule,
  ],
})
export class WorkflowModule implements OnModuleInit {
  constructor(
    @InjectQueue(DEADLINE_ESCALATION_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped outside real runtime environments — unit/e2e test suites boot `AppModule` repeatedly and shouldn't each schedule a competing repeatable job against a shared Redis. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.queue.add(
      'scan',
      {},
      { repeat: { every: ESCALATION_SCAN_INTERVAL_MS }, jobId: 'deadline-escalation-hourly' },
    )
  }
}
