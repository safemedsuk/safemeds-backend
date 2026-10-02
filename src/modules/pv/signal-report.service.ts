import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { GeneratedReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { SIGNAL_RECORD_TYPE } from './signal.service'
import { SignalReportPdfService } from './signal-report-pdf.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Signals are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Real-usage request, 22 Sep 2026 (item 22) — "generate signal reports;
 * clients should be able to upload proof they submitted the report to
 * the authority." A one-shot generate + evidence-upload pair, mirroring
 * `RegulatorySubmissionService`'s own simpler shape (no draft/QC/sign-off
 * workflow, unlike `PeriodicReportService` — a signal report is an
 * internal record of a decision already made through the signal's own
 * workflow-gated lifecycle, not itself a new regulated decision needing
 * review). Reuses the generic `GeneratedReport` primitive exactly as
 * every other report type in this codebase does, and the newly-generic
 * `ReportsService.attachEvidence()` for the evidence-upload half — no
 * new tables.
 */
@Injectable()
export class SignalReportService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: SignalReportPdfService,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    signalId: string,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    const { data, generatedAt } = await this.rls.runAsCompany(companyId, async (tx) => {
      const signal = await tx.signal.findFirst({ where: { id: signalId, companyId } })
      if (!signal) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Signal not found' })
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
      const generatingUser = await tx.user.findFirstOrThrow({ where: { id: actor.sub } })
      const links = await tx.signalCase.findMany({
        where: { signalId },
        include: { case: { select: { referenceNumber: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      })

      return {
        generatedAt: new Date(),
        data: {
          title: signal.title,
          description: signal.description,
          detectionMethod: signal.detectionMethod,
          productIdentifier: signal.productIdentifier,
          batchNumber: signal.batchNumber,
          status: signal.status,
          previousAwareness: signal.previousAwareness,
          previousAwarenessNote: signal.previousAwarenessNote,
          strengthOfEvidenceCaseCount: signal.strengthOfEvidenceCaseCount,
          clinicalRelevanceNote: signal.clinicalRelevanceNote,
          severityNote: signal.severityNote,
          patientExposureNote: signal.patientExposureNote,
          expectedRegulatoryResponseNote: signal.expectedRegulatoryResponseNote,
          assessmentNote: signal.assessmentNote,
          recommendationAction: signal.recommendationAction,
          recommendationNote: signal.recommendationNote,
          linkedCases: links.map((l) => l.case),
          companyName: company.name,
          generatedByUserFullName: generatingUser.fullName,
          createdAt: signal.createdAt,
        },
      }
    })

    // Same "slow I/O outside any open transaction" discipline every
    // other report-generating service in this codebase already follows.
    const pdf = await this.pdfService.render({ ...data, generatedAt })

    const reportId = newId()
    const file: DirectUploadFile = {
      buffer: pdf,
      originalname: `signal-report-${signalId}.pdf`,
      mimetype: 'application/pdf',
    }
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      file,
      { title: 'Signal Report' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'pv',
          reportTypeKey: 'signal_report',
          title: `Signal report — ${data.title}`,
          recordType: SIGNAL_RECORD_TYPE,
          recordId: signalId,
          status: 'final',
          generatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'signal_report_generated',
        recordType: SIGNAL_RECORD_TYPE,
        recordId: signalId,
        newValue: { reportId },
        ip: meta.ip,
      })

      return created
    })
  }
}
