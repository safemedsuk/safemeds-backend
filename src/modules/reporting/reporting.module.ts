import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { BenefitRiskController } from './benefit-risk.controller'
import { BenefitRiskService } from './benefit-risk.service'
import { DashboardController } from './dashboard.controller'
import { DashboardService } from './dashboard.service'
import { LineListingController } from './line-listing.controller'
import { LineListingService } from './line-listing.service'
import {
  LINE_LISTING_SCHEDULE_QUEUE,
  LineListingScheduleProcessor,
} from './line-listing-schedule.processor'
import { PeriodicReportController } from './periodic-report.controller'
import { PeriodicReportService } from './periodic-report.service'
import { PeriodicReportPdfService } from './periodic-report-pdf.service'
import { PeriodicReportWorkflowGuards } from './periodic-report-workflow-guards.service'
import { RiskManagementPlanController } from './risk-management-plan.controller'
import { RiskManagementPlanService } from './risk-management-plan.service'
import { RmpPdfService } from './rmp-pdf.service'
import { SafetyAlertController } from './safety-alert.controller'
import { SafetyAlertService } from './safety-alert.service'
import { SafetyLetterController } from './safety-letter.controller'
import { SafetyLetterService } from './safety-letter.service'
import { SafetyLetterPdfService } from './safety-letter-pdf.service'

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
    NotificationsModule,
    WorkflowModule,
    BullModule.registerQueueAsync({
      name: LINE_LISTING_SCHEDULE_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    DashboardController,
    LineListingController,
    PeriodicReportController,
    BenefitRiskController,
    RiskManagementPlanController,
    SafetyAlertController,
    SafetyLetterController,
  ],
  providers: [
    DashboardService,
    LineListingService,
    LineListingScheduleProcessor,
    PeriodicReportPdfService,
    PeriodicReportService,
    PeriodicReportWorkflowGuards,
    BenefitRiskService,
    RiskManagementPlanService,
    RmpPdfService,
    SafetyAlertService,
    SafetyLetterPdfService,
    SafetyLetterService,
  ],
  exports: [
    DashboardService,
    LineListingService,
    PeriodicReportService,
    BenefitRiskService,
    RiskManagementPlanService,
    SafetyAlertService,
    SafetyLetterService,
  ],
})
export class ReportingModule implements OnModuleInit {
  constructor(
    @InjectQueue(LINE_LISTING_SCHEDULE_QUEUE) private readonly lineListingQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `PvModule`'s identical guard for why. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.lineListingQueue.add(
      'scan',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'pv-line-listing-schedule-daily' },
    )
  }
}
