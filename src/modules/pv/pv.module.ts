import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EncryptionModule } from '../../common/encryption/encryption.module'
import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { ConsentModule } from '../consent/consent.module'
import { DocumentsModule } from '../documents/documents.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { RecordVersioningModule } from '../record-versioning/record-versioning.module'
import { RegulatorySubmissionModule } from '../regulatory-submission/regulatory-submission.module'
import { RolesModule } from '../roles/roles.module'
import { SignaturesModule } from '../signatures/signatures.module'
import { TasksModule } from '../tasks/tasks.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { CallLogController } from './call-log.controller'
import { CallLogService } from './call-log.service'
import { CaseFollowUpController } from './case-follow-up.controller'
import { CASE_FOLLOW_UP_QUEUE, CaseFollowUpProcessor } from './case-follow-up.processor'
import { CaseFollowUpService } from './case-follow-up.service'
import { CausalityService } from './causality.service'
import { ClinicalTrialController } from './clinical-trial.controller'
import { ClinicalTrialService } from './clinical-trial.service'
import {
  CLINICAL_TRIAL_ANNUAL_REMINDER_QUEUE,
  ClinicalTrialAnnualReminderProcessor,
} from './clinical-trial-annual-reminder.processor'
import { ClinicalTrialAnnualReminderService } from './clinical-trial-annual-reminder.service'
import { CodingService } from './coding.service'
import {
  DRAFT_REVIEW_REMINDER_QUEUE,
  DraftReviewReminderProcessor,
} from './draft-review-reminder.processor'
import { DraftReviewReminderService } from './draft-review-reminder.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { DuplicateReviewController } from './duplicate-review.controller'
import {
  DUPLICATE_SCREENING_QUEUE,
  DuplicateScreeningProcessor,
} from './duplicate-screening.processor'
import { ExpectednessService } from './expectedness.service'
import { GlobalMoleculeIntelligenceController } from './global-molecule-intelligence.controller'
import { GlobalMoleculeIntelligenceService } from './global-molecule-intelligence.service'
import { LiteratureMonitoringController } from './literature-monitoring.controller'
import { LiteratureMonitoringService } from './literature-monitoring.service'
import {
  LITERATURE_MONITORING_REMINDER_QUEUE,
  LiteratureMonitoringReminderProcessor,
} from './literature-monitoring-reminder.processor'
import { LiteratureMonitoringReminderService } from './literature-monitoring-reminder.service'
import {
  PHONE_REACHABILITY_REMINDER_QUEUE,
  PhoneReachabilityReminderProcessor,
} from './phone-reachability-reminder.processor'
import { PhoneReachabilityReminderService } from './phone-reachability-reminder.service'
import { PvCaseController, PvSourceDocumentController } from './pv-case.controller'
import { PvCaseService } from './pv-case.service'
import { PvWorkflowGuards } from './pv-workflow-guards.service'
import { SignalController } from './signal.controller'
import { SignalService } from './signal.service'
import { SIGNAL_DETECTION_QUEUE, SignalDetectionProcessor } from './signal-detection.processor'
import { SignalDetectionService } from './signal-detection.service'
import { SignalReportService } from './signal-report.service'
import { SignalReportPdfService } from './signal-report-pdf.service'
import { SignalWorkflowGuards } from './signal-workflow-guards.service'
import { SourceDocumentService } from './source-document.service'
import { TriageService } from './triage.service'
import { ValidityGateService } from './validity-gate.service'

// Both new Stage 10/11 periodic jobs are daily — the EMA guideline's own
// recommended cadence for duplicate re-screening, and a reasonable match
// for follow-up's 5-working-day/28-day windows (a coarser interval would
// mean an attempt's timeout is only noticed up to a day late, which
// doesn't materially change the 5-day/28-day math).
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
  // `DeadlineService` (needed by `TriageService`) is already exported by
  // `WorkflowModule` — no separate `CountryConfigModule` import needed
  // here, since `TriageService` never calls `RuleResolutionService`
  // directly, only through `DeadlineService`'s own internal use of it.
  // `CodingService` reads `MeddraTerm`/`WhoDrugTerm` directly off the
  // already-open RLS transaction (both are global, non-RLS tables) —
  // same reasoning, no `MasterDataModule` import needed either.
  // `NotificationsModule` (Stage 11) — real reuse of the Phase 9 email
  // engine, both `NotificationsService.create()` (in-app + email to
  // staff) and the new `sendExternalEmail()` (direct to a reporter).
  imports: [
    AuditModule,
    EncryptionModule,
    ConsentModule,
    DocumentsModule,
    RecordVersioningModule,
    WorkflowModule,
    RolesModule,
    NotificationsModule,
    RegulatorySubmissionModule,
    SignaturesModule,
    TasksModule,
    BullModule.registerQueueAsync({
      name: DUPLICATE_SCREENING_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: CASE_FOLLOW_UP_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: CLINICAL_TRIAL_ANNUAL_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: SIGNAL_DETECTION_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: LITERATURE_MONITORING_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: PHONE_REACHABILITY_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: DRAFT_REVIEW_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    PvCaseController,
    PvSourceDocumentController,
    CallLogController,
    DuplicateReviewController,
    CaseFollowUpController,
    ClinicalTrialController,
    SignalController,
    LiteratureMonitoringController,
    GlobalMoleculeIntelligenceController,
  ],
  providers: [
    PvCaseService,
    SourceDocumentService,
    PvWorkflowGuards,
    CallLogService,
    ValidityGateService,
    TriageService,
    CodingService,
    ExpectednessService,
    CausalityService,
    DuplicateDetectionService,
    DuplicateScreeningProcessor,
    CaseFollowUpService,
    CaseFollowUpProcessor,
    ClinicalTrialService,
    ClinicalTrialAnnualReminderService,
    ClinicalTrialAnnualReminderProcessor,
    SignalService,
    SignalDetectionService,
    SignalDetectionProcessor,
    SignalWorkflowGuards,
    SignalReportPdfService,
    SignalReportService,
    LiteratureMonitoringService,
    LiteratureMonitoringReminderService,
    LiteratureMonitoringReminderProcessor,
    GlobalMoleculeIntelligenceService,
    PhoneReachabilityReminderService,
    PhoneReachabilityReminderProcessor,
    DraftReviewReminderService,
    DraftReviewReminderProcessor,
  ],
  exports: [
    PvCaseService,
    SourceDocumentService,
    ValidityGateService,
    TriageService,
    CodingService,
    ExpectednessService,
    CausalityService,
    DuplicateDetectionService,
    CaseFollowUpService,
    ClinicalTrialService,
    SignalService,
    SignalDetectionService,
    LiteratureMonitoringService,
    GlobalMoleculeIntelligenceService,
  ],
})
export class PvModule implements OnModuleInit {
  constructor(
    @InjectQueue(DUPLICATE_SCREENING_QUEUE) private readonly duplicateQueue: Queue,
    @InjectQueue(CASE_FOLLOW_UP_QUEUE) private readonly followUpQueue: Queue,
    @InjectQueue(CLINICAL_TRIAL_ANNUAL_REMINDER_QUEUE) private readonly annualReminderQueue: Queue,
    @InjectQueue(SIGNAL_DETECTION_QUEUE) private readonly signalDetectionQueue: Queue,
    @InjectQueue(LITERATURE_MONITORING_REMINDER_QUEUE)
    private readonly literatureMonitoringReminderQueue: Queue,
    @InjectQueue(PHONE_REACHABILITY_REMINDER_QUEUE)
    private readonly phoneReachabilityReminderQueue: Queue,
    @InjectQueue(DRAFT_REVIEW_REMINDER_QUEUE) private readonly draftReviewReminderQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `MasterDataModule`/`WorkflowModule`'s identical guard for why. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.duplicateQueue.add(
      'scan',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'pv-duplicate-screening-daily' },
    )
    await this.followUpQueue.add(
      'sweep',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'pv-case-follow-up-daily' },
    )
    // Weekly scan cadence, same reasoning as Stage 2's own quarterly
    // product-list reminder: a company is only actually reminded once
    // per ~365 days regardless of how often the scan itself runs, so a
    // coarser interval than the follow-up/duplicate jobs is fine here.
    await this.annualReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: 7 * DAILY_SCAN_INTERVAL_MS },
        jobId: 'pv-clinical-trial-annual-reminder-weekly',
      },
    )
    // Same daily cadence as duplicate screening — see `SignalDetectionProcessor`'s own doc comment.
    await this.signalDetectionQueue.add(
      'scan',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'pv-signal-detection-daily' },
    )
    // Weekly scan — now correctly matches the real ~7-day currency window
    // (`LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS`, corrected 19 Aug 2026
    // from real field-expert source material; see that constant's own doc
    // comment) rather than the previous looser monthly assumption.
    await this.literatureMonitoringReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: 7 * DAILY_SCAN_INTERVAL_MS },
        jobId: 'pv-literature-monitoring-reminder-weekly',
      },
    )
    // Weekly scan, same reasoning — the 30-day reachability-test window
    // means a company is only actually reminded roughly monthly.
    await this.phoneReachabilityReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: 7 * DAILY_SCAN_INTERVAL_MS },
        jobId: 'pv-phone-reachability-reminder-weekly',
      },
    )
    // Real-usage request, 22 Sep 2026 (item 13) — a real 24-hour SLA needs
    // a materially finer scan cadence than the daily/weekly jobs above,
    // or a case could sit up to a day past due before anyone is
    // reminded again; `DraftReviewReminderService.scanAndRemind()`'s own
    // per-case due-ness check still governs exactly when a given draft's
    // next reminder actually fires.
    await this.draftReviewReminderQueue.add(
      'scan',
      {},
      { repeat: { every: 60 * 60 * 1000 }, jobId: 'pv-draft-review-reminder-hourly' },
    )
  }
}
