import { Module } from '@nestjs/common'

import { EncryptionModule } from '../../common/encryption/encryption.module'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { E2bXmlBuilderService } from './e2b-xml-builder.service'
import { RegulatorySubmissionController } from './regulatory-submission.controller'
import { RegulatorySubmissionService } from './regulatory-submission.service'
import { RegulatorySubmissionPdfService } from './regulatory-submission-pdf.service'
import { RegulatorySubmissionWorkflowGuards } from './regulatory-submission-workflow-guards.service'
import { ReportabilityService } from './reportability.service'

/**
 * VigiCloud Stage 12 — deliberately does **not** import `PvModule`
 * (only `PV_CASE_RECORD_TYPE`, a plain TS const, is imported directly
 * from `../pv/pv-case.service`, not through Nest DI) — `PvModule`
 * imports this module instead (for `PvCaseController`'s two case-scoped
 * endpoints), so the dependency only ever points one way.
 */
@Module({
  imports: [AuditModule, EncryptionModule, DocumentsModule, WorkflowModule],
  controllers: [RegulatorySubmissionController],
  providers: [
    ReportabilityService,
    E2bXmlBuilderService,
    RegulatorySubmissionPdfService,
    RegulatorySubmissionService,
    RegulatorySubmissionWorkflowGuards,
  ],
  exports: [
    ReportabilityService,
    E2bXmlBuilderService,
    RegulatorySubmissionPdfService,
    RegulatorySubmissionService,
  ],
})
export class RegulatorySubmissionModule {}
