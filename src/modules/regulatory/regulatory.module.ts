import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EncryptionModule } from '../../common/encryption/encryption.module'
import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { InternalAuditModule } from '../internal-audit/internal-audit.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TasksModule } from '../tasks/tasks.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { ClassificationService } from './classification.service'
import { CompletenessGateService } from './completeness-gate.service'
import { EngagementModelService } from './engagement-model.service'
import { ImportExportPermitController } from './import-export-permit.controller'
import { ImportExportPermitService } from './import-export-permit.service'
import { MockRecallReadinessController } from './mock-recall-readiness.controller'
import { MockRecallReadinessService } from './mock-recall-readiness.service'
import { ProductClassController } from './product-class.controller'
import { ProductClassService } from './product-class.service'
import { PromotionalMaterialSubmissionController } from './promotional-material-submission.controller'
import { PromotionalMaterialSubmissionService } from './promotional-material-submission.service'
import { PromotionalMaterialWorkflowGuards } from './promotional-material-workflow-guards.service'
import { RecallController } from './recall.controller'
import { RecallService } from './recall.service'
import { RecallClosureGateController } from './recall-closure-gate.controller'
import { RecallClosureGateService } from './recall-closure-gate.service'
import { RecallCompliancePackController } from './recall-compliance-pack.controller'
import { RecallCompliancePackService } from './recall-compliance-pack.service'
import { RecallCompliancePackPdfService } from './recall-compliance-pack-pdf.service'
import { RecallCountryController } from './recall-country.controller'
import { RecallCountryService } from './recall-country.service'
import { RecallDestructionActionsController, RecallDestructionController } from './recall-destruction.controller'
import { RecallDestructionService } from './recall-destruction.service'
import { RecallDistributionController } from './recall-distribution.controller'
import { RecallDistributionService } from './recall-distribution.service'
import { RecallEvidenceController } from './recall-evidence.controller'
import { RecallEvidenceService } from './recall-evidence.service'
import { RecallMessageController } from './recall-message.controller'
import { RecallMessageService } from './recall-message.service'
import { RecallPortalController } from './recall-portal.controller'
import { RecallPortalService } from './recall-portal.service'
import { RecallPortalPublicController } from './recall-portal-public.controller'
import { RecallQuarantineController } from './recall-quarantine.controller'
import { RecallQuarantineService } from './recall-quarantine.service'
import { RecallReconciliationController } from './recall-reconciliation.controller'
import { RecallReconciliationService } from './recall-reconciliation.service'
import { RecallRuleSetController } from './recall-rule-set.controller'
import { RecallRuleSetService } from './recall-rule-set.service'
import { RecallScopeController } from './recall-scope.controller'
import { RecallScopeService } from './recall-scope.service'
import { RecallSightingController } from './recall-sighting.controller'
import { RecallSightingService } from './recall-sighting.service'
import { RecallSubmissionController } from './recall-submission.controller'
import { RecallSubmissionService } from './recall-submission.service'
import { RecallSubmissionPdfService } from './recall-submission-pdf.service'
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
import { RegEntitiesImportController } from './reg-entities-import.controller'
import { RegEntitiesImportService } from './reg-entities-import.service'
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
import { RegQueryController, RegQueryRegisterController } from './reg-query.controller'
import { RegQueryService } from './reg-query.service'
import { REG_QUERY_REMINDER_QUEUE, RegQueryReminderProcessor } from './reg-query-reminder.processor'
import { RegQueryReminderService } from './reg-query-reminder.service'
import { REG_RENEWAL_REMINDER_QUEUE, RegRenewalReminderProcessor } from './reg-renewal-reminder.processor'
import { RegRenewalReminderService } from './reg-renewal-reminder.service'
import { RegReportingController } from './reg-reporting.controller'
import { RegReportingService } from './reg-reporting.service'
import { RegRetentionController } from './reg-retention.controller'
import { RegRetentionService } from './reg-retention.service'
import { RegRetentionPdfService } from './reg-retention-pdf.service'
import {
  REG_RETENTION_REMINDER_QUEUE,
  RegRetentionReminderProcessor,
} from './reg-retention-reminder.processor'
import { RegRetentionReminderService } from './reg-retention-reminder.service'
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
import { StakeholderController } from './stakeholder.controller'
import { StakeholderService } from './stakeholder.service'

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
// testing-correction-explanation.md §3.2/§3.4 — these two genuinely need
// to fire weekly, not daily (the reminder is meant to repeat "every
// week," see each service's own doc comment for why no Task-history
// de-duplication is used instead).
const REG_RENEWAL_REMINDER_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
/** Daily, not weekly — see `RegQueryReminderService`'s own doc comment on why a query-response clock needs a tighter scan cadence than a multi-year renewal clock. */
const REG_QUERY_REMINDER_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
const REG_RETENTION_REMINDER_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

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
    InternalAuditModule,
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
    BullModule.registerQueueAsync({
      name: REG_RENEWAL_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: REG_RETENTION_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: REG_QUERY_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    RegConfigController,
    RegEntitiesController,
    RegEntitiesImportController,
    RegDossierController,
    RegDeadlineController,
    RegFeeLedgerController,
    RegSubmissionController,
    RegQueryController,
    RegQueryRegisterController,
    RegVariationController,
    RegPostMarketObligationController,
    RegRetentionController,
    RegistrationArchiveController,
    ImportExportPermitController,
    PromotionalMaterialSubmissionController,
    RecallController,
    RelianceApplicationController,
    RegReportingController,
    ProductClassController,
    RecallRuleSetController,
    RecallCountryController,
    RecallScopeController,
    RecallSubmissionController,
    StakeholderController,
    RecallDistributionController,
    RecallSightingController,
    RecallPortalController,
    RecallPortalPublicController,
    RecallMessageController,
    RecallQuarantineController,
    RecallReconciliationController,
    RecallDestructionController,
    RecallDestructionActionsController,
    RecallClosureGateController,
    RecallCompliancePackController,
    RecallEvidenceController,
    MockRecallReadinessController,
  ],
  providers: [
    RegConfigService,
    RegEntitiesService,
    RegEntitiesImportService,
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
    RegRetentionService,
    RegRetentionPdfService,
    RegRenewalReminderService,
    RegRenewalReminderProcessor,
    RegRetentionReminderService,
    RegRetentionReminderProcessor,
    RegQueryReminderService,
    RegQueryReminderProcessor,
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
    RecallRuleSetService,
    RecallCountryService,
    RecallScopeService,
    RecallSubmissionPdfService,
    RecallSubmissionService,
    StakeholderService,
    RecallDistributionService,
    RecallSightingService,
    RecallPortalService,
    RecallMessageService,
    RecallQuarantineService,
    RecallReconciliationService,
    RecallDestructionService,
    RecallClosureGateService,
    RecallCompliancePackService,
    RecallCompliancePackPdfService,
    RecallEvidenceService,
    MockRecallReadinessService,
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
    RegRetentionService,
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
    @InjectQueue(REG_RENEWAL_REMINDER_QUEUE) private readonly renewalReminderQueue: Queue,
    @InjectQueue(REG_RETENTION_REMINDER_QUEUE) private readonly retentionReminderQueue: Queue,
    @InjectQueue(REG_QUERY_REMINDER_QUEUE) private readonly queryReminderQueue: Queue,
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
    await this.renewalReminderQueue.add(
      'scan',
      {},
      { repeat: { every: REG_RENEWAL_REMINDER_SCAN_INTERVAL_MS }, jobId: 'reg-renewal-reminder-weekly' },
    )
    await this.retentionReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: REG_RETENTION_REMINDER_SCAN_INTERVAL_MS },
        jobId: 'reg-retention-reminder-weekly',
      },
    )
    await this.queryReminderQueue.add(
      'scan',
      {},
      { repeat: { every: REG_QUERY_REMINDER_SCAN_INTERVAL_MS }, jobId: 'reg-query-reminder-daily' },
    )
  }
}
