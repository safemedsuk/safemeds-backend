import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TasksModule } from '../tasks/tasks.module'
import { CapaController } from './capa.controller'
import { CapaService } from './capa.service'
import { CAPA_OVERDUE_QUEUE, CapaOverdueProcessor } from './capa-overdue.processor'
import { InspectionChecklistController } from './inspection-checklist.controller'
import { InspectionChecklistService } from './inspection-checklist.service'
import { InspectionReadinessController } from './inspection-readiness.controller'
import { InspectionReadinessService } from './inspection-readiness.service'
import { InspectionReadinessPdfService } from './inspection-readiness-pdf.service'
import { InternalAuditController } from './internal-audit.controller'
import { InternalAuditService } from './internal-audit.service'
import { InternalAuditChecklistController } from './internal-audit-checklist.controller'
import { InternalAuditChecklistService } from './internal-audit-checklist.service'
import { ManagementReviewController } from './management-review.controller'
import { ManagementReviewService } from './management-review.service'
import {
  MANAGEMENT_REVIEW_REMINDER_QUEUE,
  ManagementReviewReminderProcessor,
} from './management-review-reminder.processor'
import { ManagementReviewReminderService } from './management-review-reminder.service'
import { QualityMetricsController } from './quality-metrics.controller'
import { QualityMetricsService } from './quality-metrics.service'
import {
  QUALITY_TREND_DETECTION_QUEUE,
  QualityTrendDetectionProcessor,
} from './quality-trend-detection.processor'
import { QualityTrendDetectionService } from './quality-trend-detection.service'
import { RegulatoryInspectionResponseController } from './regulatory-inspection-response.controller'
import { RegulatoryInspectionResponseService } from './regulatory-inspection-response.service'

const CAPA_OVERDUE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Daily — matches `QualityTrendDetectionService`'s own doc comment on why a CAPA-count trend clock needs a tighter cadence than a renewal-scale one. */
const QUALITY_TREND_DETECTION_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Weekly — matches `RegRenewalReminderService`'s own established cadence for a quarterly-scale obligation. */
const MANAGEMENT_REVIEW_REMINDER_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

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

/**
 * QualCloud (Phase 13) Stages 0/3/8/9 — `InternalAudit`/`AuditFinding`/
 * `Capa` (reused unchanged from VigiCloud Stage 16.3) plus this
 * module's own new Stage 8 (Metrics, Trending & Management Review) and
 * Stage 9 (Audit & Inspection Management) additions. Kept in this same
 * module — imported BY `QualityModule`, never the reverse — since every
 * new Stage 8/9 service reads plain Prisma tables (Deviation, Complaint,
 * Oos, TrainingRecord, Sop, ...) directly via `RlsService`, the same way
 * every service in this codebase already crosses model boundaries
 * freely; no circular import is created by placing them here.
 */
@Module({
  imports: [
    AuditModule,
    TasksModule,
    NotificationsModule,
    DocumentsModule,
    BullModule.registerQueueAsync({
      name: CAPA_OVERDUE_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: QUALITY_TREND_DETECTION_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: MANAGEMENT_REVIEW_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    InternalAuditController,
    CapaController,
    QualityMetricsController,
    ManagementReviewController,
    InspectionChecklistController,
    InternalAuditChecklistController,
    RegulatoryInspectionResponseController,
    InspectionReadinessController,
  ],
  providers: [
    InternalAuditService,
    CapaService,
    CapaOverdueProcessor,
    QualityMetricsService,
    QualityTrendDetectionService,
    QualityTrendDetectionProcessor,
    ManagementReviewService,
    ManagementReviewReminderService,
    ManagementReviewReminderProcessor,
    InspectionChecklistService,
    InternalAuditChecklistService,
    RegulatoryInspectionResponseService,
    InspectionReadinessService,
    InspectionReadinessPdfService,
  ],
  exports: [
    InternalAuditService,
    CapaService,
    QualityMetricsService,
    QualityTrendDetectionService,
    ManagementReviewService,
    InspectionReadinessService,
  ],
})
export class InternalAuditModule implements OnModuleInit {
  constructor(
    @InjectQueue(CAPA_OVERDUE_QUEUE) private readonly capaOverdueQueue: Queue,
    @InjectQueue(QUALITY_TREND_DETECTION_QUEUE) private readonly trendDetectionQueue: Queue,
    @InjectQueue(MANAGEMENT_REVIEW_REMINDER_QUEUE) private readonly reviewReminderQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — unit/e2e suites boot `AppModule` repeatedly and shouldn't each schedule a competing repeatable job against a shared Redis. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.capaOverdueQueue.add(
      'scan',
      {},
      { repeat: { every: CAPA_OVERDUE_SCAN_INTERVAL_MS }, jobId: 'capa-overdue-daily' },
    )
    await this.trendDetectionQueue.add(
      'scan',
      {},
      {
        repeat: { every: QUALITY_TREND_DETECTION_SCAN_INTERVAL_MS },
        jobId: 'quality-trend-detection-daily',
      },
    )
    await this.reviewReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: MANAGEMENT_REVIEW_REMINDER_SCAN_INTERVAL_MS },
        jobId: 'management-review-reminder-weekly',
      },
    )
  }
}
