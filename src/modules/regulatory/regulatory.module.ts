import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EncryptionModule } from '../../common/encryption/encryption.module'
import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TasksModule } from '../tasks/tasks.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { ClassificationService } from './classification.service'
import { CompletenessGateService } from './completeness-gate.service'
import { EngagementModelService } from './engagement-model.service'
import { ImportExportPermitController } from './import-export-permit.controller'
import { ImportExportPermitService } from './import-export-permit.service'
import { ProductClassController } from './product-class.controller'
import { ProductClassService } from './product-class.service'
import { PromotionalMaterialSubmissionController } from './promotional-material-submission.controller'
import { PromotionalMaterialSubmissionService } from './promotional-material-submission.service'
import { PromotionalMaterialWorkflowGuards } from './promotional-material-workflow-guards.service'
import { RecallController } from './recall.controller'
import { RecallService } from './recall.service'
import { RecallWorkflowGuards } from './recall-workflow-guards.service'
import { RegConfigController } from './reg-config.controller'
import { RegConfigService } from './reg-config.service'
import { RegDeadlineController } from './reg-deadline.controller'
import { RegDeadlineService } from './reg-deadline.service'
import { REG_DEADLINE_ESCALATION_NOTIFIER } from './reg-deadline-escalation.interface'
import {
  REG_DEADLINE_ESCALATION_QUEUE,
  RegDeadlineEscalationProcessor,
} from './reg-deadline-escalation.processor'
import { RegDeadlineTaskEscalationNotifier } from './reg-deadline-task-escalation-notifier'
import { RegDossierController } from './reg-dossier.controller'
import { RegDossierService } from './reg-dossier.service'
import { RegEngagementModelGuards } from './reg-engagement-model-guards.service'
import { RegEntitiesController } from './reg-entities.controller'
import { RegEntitiesService } from './reg-entities.service'
import { RegFeeLedgerController } from './reg-fee-ledger.controller'
import { RegFeeLedgerService } from './reg-fee-ledger.service'
import { REG_FEE_OVERDUE_QUEUE, RegFeeOverdueProcessor } from './reg-fee-overdue.processor'
import {
  REG_LICENSING_EXPIRY_QUEUE,
  RegLicensingExpiryProcessor,
} from './reg-licensing-expiry.processor'
import { RegLicensingExpiryService } from './reg-licensing-expiry.service'
import { RegPostMarketObligationController } from './reg-post-market-obligation.controller'
import {
  REG_POST_MARKET_OBLIGATION_QUEUE,
  RegPostMarketObligationProcessor,
} from './reg-post-market-obligation.processor'
import { RegPostMarketObligationService } from './reg-post-market-obligation.service'
import { RegPostMarketObligationPdfService } from './reg-post-market-obligation-pdf.service'
import { RegQueryController } from './reg-query.controller'
import { RegQueryService } from './reg-query.service'
import { RegReportingController } from './reg-reporting.controller'
import { RegReportingService } from './reg-reporting.service'
import { RegSubmissionController } from './reg-submission.controller'
import { RegSubmissionService } from './reg-submission.service'
import { RegSubmissionPdfService } from './reg-submission-pdf.service'
import { RegVariationController } from './reg-variation.controller'
import { RegVariationService } from './reg-variation.service'
import { RegWorkflowGuards } from './reg-workflow-guards.service'
import { RegistrationArchiveController } from './registration-archive.controller'
import { RegistrationArchiveService } from './registration-archive.service'
import { RelianceApplicationController } from './reliance-application.controller'
import { RelianceApplicationService } from './reliance-application.service'

/**
 * RegCloud (Phase 12) Stage 0 — Foundation. One module for all sub-stages
 * (0.1 country rule-set graph, 0.2 entity/hierarchy, 0.3 dossier assembly,
 * 0.4 deadline engine, 0.5 fees ledger) — they're small and tightly
 * interdependent (dossier creation resolves against the rule graph; the
 * deadline/fee engines resolve against their own rule tables), matching
 * `PvModule`'s own "one module, several services" shape rather than
 * splitting into several modules that would just re-import each other.
 *
 * Both escalation scans run daily, not hourly (`MasterDataModule`'s own
 * weekly product-review-reminder queue is the closer precedent — a
 * renewal-scale deadline or a fee due date moves in months/weeks, not
 * hours).
 */
const REG_DEADLINE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
const REG_FEE_OVERDUE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
const REG_POST_MARKET_OBLIGATION_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
const REG_LICENSING_EXPIRY_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000

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
    TasksModule,
    NotificationsModule,
    TenancyModule,
    WorkflowModule,
    DocumentsModule,
    EncryptionModule,
    BullModule.registerQueueAsync({
      name: REG_DEADLINE_ESCALATION_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: REG_FEE_OVERDUE_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: REG_POST_MARKET_OBLIGATION_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: REG_LICENSING_EXPIRY_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    RegConfigController,
    RegEntitiesController,
    RegDossierController,
    RegDeadlineController,
    RegFeeLedgerController,
    RegSubmissionController,
    RegQueryController,
    RegVariationController,
    RegPostMarketObligationController,
    RegistrationArchiveController,
    ImportExportPermitController,
    PromotionalMaterialSubmissionController,
    RecallController,
    RelianceApplicationController,
    RegReportingController,
    ProductClassController,
  ],
  providers: [
    RegConfigService,
    RegEntitiesService,
    RegDossierService,
    RegDeadlineService,
    RegFeeLedgerService,
    RegDeadlineEscalationProcessor,
    RegFeeOverdueProcessor,
    ClassificationService,
    CompletenessGateService,
    RegWorkflowGuards,
    RegSubmissionService,
    RegSubmissionPdfService,
    RegQueryService,
    RegVariationService,
    RegPostMarketObligationService,
    RegPostMarketObligationPdfService,
    RegPostMarketObligationProcessor,
    RegistrationArchiveService,
    ImportExportPermitService,
    RegLicensingExpiryService,
    RegLicensingExpiryProcessor,
    { provide: REG_DEADLINE_ESCALATION_NOTIFIER, useClass: RegDeadlineTaskEscalationNotifier },
    PromotionalMaterialSubmissionService,
    PromotionalMaterialWorkflowGuards,
    RecallService,
    RecallWorkflowGuards,
    EngagementModelService,
    RegEngagementModelGuards,
    RelianceApplicationService,
    RegReportingService,
    ProductClassService,
  ],
  exports: [
    RegConfigService,
    RegEntitiesService,
    RegDossierService,
    RegDeadlineService,
    RegFeeLedgerService,
    ClassificationService,
    CompletenessGateService,
    RegSubmissionService,
    RegQueryService,
    RegVariationService,
    RegPostMarketObligationService,
    PromotionalMaterialSubmissionService,
    RecallService,
    EngagementModelService,
    RelianceApplicationService,
    RegReportingService,
    ProductClassService,
  ],
})
export class RegulatoryModule implements OnModuleInit {
  constructor(
    @InjectQueue(REG_DEADLINE_ESCALATION_QUEUE) private readonly deadlineQueue: Queue,
    @InjectQueue(REG_FEE_OVERDUE_QUEUE) private readonly feeOverdueQueue: Queue,
    @InjectQueue(REG_POST_MARKET_OBLIGATION_QUEUE)
    private readonly postMarketObligationQueue: Queue,
    @InjectQueue(REG_LICENSING_EXPIRY_QUEUE) private readonly licensingExpiryQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `MasterDataModule`'s identical guard for why. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.deadlineQueue.add(
      'scan',
      {},
      { repeat: { every: REG_DEADLINE_SCAN_INTERVAL_MS }, jobId: 'reg-deadline-escalation-daily' },
    )
    await this.feeOverdueQueue.add(
      'scan',
      {},
      { repeat: { every: REG_FEE_OVERDUE_SCAN_INTERVAL_MS }, jobId: 'reg-fee-overdue-daily' },
    )
    await this.postMarketObligationQueue.add(
      'scan',
      {},
      {
        repeat: { every: REG_POST_MARKET_OBLIGATION_SCAN_INTERVAL_MS },
        jobId: 'reg-post-market-obligation-daily',
      },
    )
    await this.licensingExpiryQueue.add(
      'scan',
      {},
      {
        repeat: { every: REG_LICENSING_EXPIRY_SCAN_INTERVAL_MS },
        jobId: 'reg-licensing-expiry-daily',
      },
    )
  }
}
