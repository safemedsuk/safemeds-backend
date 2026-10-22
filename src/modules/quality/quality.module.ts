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
import { PvModule } from '../pv/pv.module'
import { RegulatoryModule } from '../regulatory/regulatory.module'
import { SignaturesModule } from '../signatures/signatures.module'
import { TasksModule } from '../tasks/tasks.module'
import { TrainingModule } from '../training/training.module'
import { WorkflowModule } from '../workflow/workflow.module'
import {
  BatchRecordReviewController,
  QualityBatchController,
} from './batch-record-review.controller'
import { BatchRecordReviewService } from './batch-record-review.service'
import { BatchReleaseController } from './batch-release.controller'
import { BatchReleaseService } from './batch-release.service'
import { BatchTraceabilityService } from './batch-traceability.service'
import { ChangeControlController } from './change-control.controller'
import { ChangeControlService } from './change-control.service'
import { ComplaintController } from './complaint.controller'
import { ComplaintService } from './complaint.service'
import { DeviationController } from './deviation.controller'
import { DeviationService } from './deviation.service'
import { DeviationInvestigationReminderService } from './deviation-investigation-reminder.service'
import {
  DocumentAcknowledgmentController,
  DocumentAcknowledgmentOverdueController,
} from './document-acknowledgment.controller'
import { DocumentAcknowledgmentService } from './document-acknowledgment.service'
import { DocumentNumberingService } from './document-numbering.service'
import { EnvironmentalMonitoringController } from './environmental-monitoring.controller'
import { EnvironmentalMonitoringService } from './environmental-monitoring.service'
import { EquipmentController } from './equipment.controller'
import { EquipmentService } from './equipment.service'
import { EquipmentQualificationController } from './equipment-qualification.controller'
import { EquipmentQualificationService } from './equipment-qualification.service'
import { FalsifiedProductReportController } from './falsified-product-report.controller'
import { FalsifiedProductReportService } from './falsified-product-report.service'
import { OosController } from './oos.controller'
import { OosService } from './oos.service'
import { PqrController } from './pqr.controller'
import { PqrService } from './pqr.service'
import { PqrPdfService } from './pqr-pdf.service'
import { QualityConfigController } from './quality-config.controller'
import {
  CALIBRATION_MAINTENANCE_QUEUE,
  CalibrationMaintenanceScanProcessor,
  DEVIATION_INVESTIGATION_REMINDER_QUEUE,
  DeviationInvestigationReminderProcessor,
  SUPPLIER_BIENNIAL_REVIEW_REMINDER_QUEUE,
  SUPPLIER_REQUALIFICATION_QUEUE,
  SupplierBiennialReviewReminderProcessor,
  SupplierRequalificationProcessor,
} from './quality-scan.processor'
import { QualityWorkflowGuards } from './quality-workflow-guards.service'
import { RetentionPolicyController } from './retention-policy.controller'
import { RetentionPolicyService } from './retention-policy.service'
import { RiskAssessmentController } from './risk-assessment.controller'
import { RiskAssessmentService } from './risk-assessment.service'
import { SopController } from './sop.controller'
import { SopService } from './sop.service'
import { SpecificationController } from './specification.controller'
import { SpecificationService } from './specification.service'
import { StabilityController } from './stability.controller'
import { StabilityService } from './stability.service'
import { SupplierController } from './supplier.controller'
import { SupplierService } from './supplier.service'
import { SupplierBiennialReviewReminderService } from './supplier-biennial-review-reminder.service'
import {
  CertificateOfAnalysisController,
  SupplierQualificationController,
} from './supplier-qualification.controller'
import { SupplierQualificationService } from './supplier-qualification.service'
import { ValidationController } from './validation.controller'
import { ValidationService } from './validation.service'
import { WasteDestructionPdfService } from './waste-destruction-pdf.service'
import {
  WasteDisposalController,
  WasteDisposalMethodCatalogController,
  WasteDisposalMethodCatalogReadController,
} from './waste-disposal.controller'
import { WasteDisposalService } from './waste-disposal.service'
import { WasteDisposalCaseController } from './waste-disposal-case.controller'
import { WasteDisposalCaseService } from './waste-disposal-case.service'
import { WasteDisposalMethodCatalogService } from './waste-disposal-method-catalog.service'

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

const SUPPLIER_REQUALIFICATION_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
const CALIBRATION_MAINTENANCE_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Daily — an investigation's approaching/overdue reminder cadence (Pass A2 item 5b). */
const DEVIATION_INVESTIGATION_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Daily — the biennial supplier performance review reminder (Pass B item D3). */
const SUPPLIER_BIENNIAL_REVIEW_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * QualCloud (Phase 13) Stages 0–7 — Foundation Layer, Document Control,
 * Deviation & Non-Conformance Management, Change Control, Complaint
 * Handling, OOS/OOT Investigation, and Batch Traceability/Record
 * Review/Disposition. One module for every sub-stage (matching
 * `RegulatoryModule`'s own established "small, tightly interdependent
 * sub-stages, one module" precedent) — the `Capa` generalization/full
 * lifecycle itself lives on `InternalAuditModule`'s existing
 * `CapaService`, reused unchanged via this module's own `imports`,
 * never duplicated here. Stage 4 imports `RegulatoryModule` for the
 * real `RegVariationService.create()` cross-module join; Stage 5
 * imports `PvModule` for the real `PvCaseService.createFromSystemChannel()`
 * AE-routing join; Stage 7 imports `SignaturesModule` for
 * `BatchRecordReviewService`'s direct signature-gated disposition.
 */
@Module({
  imports: [
    AuditModule,
    WorkflowModule,
    InternalAuditModule,
    EncryptionModule,
    NotificationsModule,
    RegulatoryModule,
    PvModule,
    SignaturesModule,
    TasksModule,
    TrainingModule,
    DocumentsModule,
    BullModule.registerQueueAsync({
      name: SUPPLIER_REQUALIFICATION_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: CALIBRATION_MAINTENANCE_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: DEVIATION_INVESTIGATION_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
    BullModule.registerQueueAsync({
      name: SUPPLIER_BIENNIAL_REVIEW_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [
    SupplierController,
    SupplierQualificationController,
    CertificateOfAnalysisController,
    EquipmentController,
    EquipmentQualificationController,
    SopController,
    SpecificationController,
    RetentionPolicyController,
    RiskAssessmentController,
    QualityConfigController,
    DocumentAcknowledgmentController,
    DocumentAcknowledgmentOverdueController,
    DeviationController,
    ChangeControlController,
    ComplaintController,
    OosController,
    BatchRecordReviewController,
    QualityBatchController,
    PqrController,
    WasteDisposalController,
    WasteDisposalCaseController,
    WasteDisposalMethodCatalogController,
    WasteDisposalMethodCatalogReadController,
    FalsifiedProductReportController,
    BatchReleaseController,
    ValidationController,
    EnvironmentalMonitoringController,
    StabilityController,
  ],
  providers: [
    SupplierService,
    SupplierQualificationService,
    SupplierRequalificationProcessor,
    EquipmentService,
    EquipmentQualificationService,
    CalibrationMaintenanceScanProcessor,
    DeviationInvestigationReminderService,
    DeviationInvestigationReminderProcessor,
    SupplierBiennialReviewReminderService,
    SupplierBiennialReviewReminderProcessor,
    SopService,
    DocumentNumberingService,
    SpecificationService,
    RetentionPolicyService,
    RiskAssessmentService,
    DocumentAcknowledgmentService,
    DeviationService,
    QualityWorkflowGuards,
    ChangeControlService,
    ComplaintService,
    OosService,
    BatchRecordReviewService,
    BatchTraceabilityService,
    PqrService,
    PqrPdfService,
    WasteDisposalService,
    WasteDisposalCaseService,
    WasteDestructionPdfService,
    WasteDisposalMethodCatalogService,
    FalsifiedProductReportService,
    BatchReleaseService,
    ValidationService,
    EnvironmentalMonitoringService,
    StabilityService,
  ],
  exports: [
    SupplierService,
    SupplierQualificationService,
    EquipmentService,
    EquipmentQualificationService,
    SopService,
    SpecificationService,
    RetentionPolicyService,
    RiskAssessmentService,
    DocumentAcknowledgmentService,
    DeviationService,
    ChangeControlService,
    ComplaintService,
    OosService,
    BatchRecordReviewService,
    BatchTraceabilityService,
    PqrService,
    WasteDisposalService,
    WasteDisposalMethodCatalogService,
    FalsifiedProductReportService,
    BatchReleaseService,
    ValidationService,
    EnvironmentalMonitoringService,
    StabilityService,
  ],
})
export class QualityModule implements OnModuleInit {
  constructor(
    @InjectQueue(SUPPLIER_REQUALIFICATION_QUEUE) private readonly supplierRequalQueue: Queue,
    @InjectQueue(CALIBRATION_MAINTENANCE_QUEUE) private readonly calibrationQueue: Queue,
    @InjectQueue(DEVIATION_INVESTIGATION_REMINDER_QUEUE)
    private readonly investigationReminderQueue: Queue,
    @InjectQueue(SUPPLIER_BIENNIAL_REVIEW_REMINDER_QUEUE)
    private readonly supplierBiennialQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.supplierRequalQueue.add(
      'scan',
      {},
      {
        repeat: { every: SUPPLIER_REQUALIFICATION_SCAN_INTERVAL_MS },
        jobId: 'supplier-requalification-daily',
      },
    )
    await this.calibrationQueue.add(
      'scan',
      {},
      {
        repeat: { every: CALIBRATION_MAINTENANCE_SCAN_INTERVAL_MS },
        jobId: 'calibration-maintenance-daily',
      },
    )
    await this.investigationReminderQueue.add(
      'scan',
      {},
      {
        repeat: { every: DEVIATION_INVESTIGATION_REMINDER_INTERVAL_MS },
        jobId: 'deviation-investigation-reminder-daily',
      },
    )
    await this.supplierBiennialQueue.add(
      'scan',
      {},
      {
        repeat: { every: SUPPLIER_BIENNIAL_REVIEW_REMINDER_INTERVAL_MS },
        jobId: 'supplier-biennial-review-reminder-daily',
      },
    )
  }
}
