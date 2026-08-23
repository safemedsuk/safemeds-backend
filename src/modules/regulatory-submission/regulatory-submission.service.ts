import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, RegulatorySubmission } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { StorageService } from '../documents/storage.service'
import { PV_CASE_RECORD_TYPE, RequestMeta } from '../pv/pv-case.service'
import { E2bXmlBuilderService } from './e2b-xml-builder.service'
import { SubmissionCaseData } from './regulatory-submission.types'
import { RegulatorySubmissionPdfService } from './regulatory-submission-pdf.service'
import { ReportabilityService } from './reportability.service'

export const REGULATORY_SUBMISSION_RECORD_TYPE = 'regulatory_submission'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export type RegulatorySubmissionWithMeta = RegulatorySubmission & {
  authority: { id: string; code: string; name: string }
  case: { id: string; referenceNumber: string }
}

/**
 * VigiCloud Stage 12 — orchestrates E2B generation: loads the full case
 * graph (real decryption, real MedDRA/WHODrug version data, not the
 * frontend-shaped `CaseWithGraph`), resolves which authority/channel
 * this report type actually uses (`SubmissionFormat`, Stage 4.1 — real
 * reuse, not a new lookup), builds the XML and PDF, stores both through
 * the already-built Documents/R2 pipeline
 * (`DocumentsService.uploadDirect()`), and records one
 * `RegulatorySubmission` row per attempt. Evidence attachment is a
 * separate, later step — see `attachEvidence()` — deliberately **not**
 * bundled with generation, and deliberately **not** the thing that
 * transitions the case's workflow either: the existing generic
 * `WorkflowActionsPanel`/`POST /workflow/instances/:id/transition` path
 * already does that, gated by a new guard
 * (`RegulatorySubmissionWorkflowGuards`) that checks evidence is
 * attached — the same "block the generic transition, don't build a
 * bespoke one" pattern every guard in this codebase already follows.
 */
@Injectable()
export class RegulatorySubmissionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly textEncryption: TextEncryptionService,
    private readonly documentsService: DocumentsService,
    private readonly reportabilityService: ReportabilityService,
    private readonly xmlBuilder: E2bXmlBuilderService,
    private readonly pdfService: RegulatorySubmissionPdfService,
    private readonly storageService: StorageService,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    caseId: string,
    meta: RequestMeta,
  ): Promise<RegulatorySubmissionWithMeta> {
    const companyId = requireCompany(actor)

    const { workflowState, submissionFormat, reportability } = await this.rls.runAsCompany(
      companyId,
      async (tx) => {
        const instance = await tx.workflowInstance.findFirst({
          where: { recordType: PV_CASE_RECORD_TYPE, recordId: caseId },
          include: { currentState: true },
        })
        const pvCase = await tx.case.findFirst({ where: { id: caseId, companyId } })
        if (!pvCase)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })

        const submissionFormat = await tx.submissionFormat.findFirst({
          where: { reportTypeId: pvCase.reportTypeId, status: 'active' },
          include: { authority: true },
        })

        return {
          workflowState: instance?.currentState.stateKey ?? null,
          submissionFormat,
          reportability: await this.reportabilityService.assess(actor, caseId),
        }
      },
    )

    if (workflowState !== 'submission_ready') {
      throw new ConflictException({
        code: 'CASE_NOT_SUBMISSION_READY',
        message: `A submission can only be generated once the case has cleared QC review and reached Submission Ready (currently: ${workflowState ?? 'unknown'}).`,
      })
    }
    if (!submissionFormat) {
      throw new ConflictException({
        code: 'NO_SUBMISSION_FORMAT',
        message: 'No active submission format is configured for this report type.',
      })
    }
    if (submissionFormat.channel !== 'vigiflow') {
      throw new BadRequestException({
        code: 'UNSUPPORTED_CHANNEL',
        message: `This report type submits via the "${submissionFormat.channel}" channel, not E2B — this action only generates VigiFlow-style E2B(R3) XML/PDF.`,
      })
    }

    // Deliberately **not** one single open transaction from here on — PDF
    // rendering and two real R2 uploads are slow, network-bound work
    // (each upload alone can take over a second under real conditions),
    // and holding a Postgres transaction open across all of it risks
    // exhausting Prisma's interactive-transaction timeout and tying up a
    // connection-pool slot for no reason: none of this needs the DB.
    // `DocumentsService.uploadDirect()` still gets its own short-lived,
    // real RLS transaction per call (`RlsService.runAsCompany()` opens a
    // fresh one whenever it isn't already inside one) — this only
    // changes what it's nested *inside*, not its own guarantees.
    const generatingUser = await this.rls.runAsCompany(companyId, (tx) =>
      tx.user.findFirstOrThrow({ where: { id: actor.sub } }),
    )
    const data = await this.rls.runAsCompany(companyId, (tx) =>
      this.loadCaseData(
        tx,
        companyId,
        caseId,
        submissionFormat.authorityId,
        generatingUser.fullName,
      ),
    )

    const submissionNumber =
      (await this.rls.runAsCompany(companyId, (tx) =>
        tx.regulatorySubmission.count({ where: { caseId } }),
      )) + 1
    data.submissionNumber = submissionNumber

    // Real-usage feedback, 19 Aug 2026 — an admin-uploaded emblem's real
    // bytes, fetched here (outside any transaction, same discipline as
    // the PDF render/R2 upload below) so the PDF service never needs to
    // touch storage itself. Missing/unreadable never fails generation —
    // it just falls back to the bundled asset or no emblem, matching
    // `resolveEmblemPath()`'s own "never a fabricated or wrong one, just
    // absent" precedent.
    if (data.authority.emblemObjectKey) {
      try {
        data.emblemBuffer = await this.storageService.getObjectBuffer(
          data.authority.emblemObjectKey,
        )
      } catch {
        data.emblemBuffer = null
      }
    }

    const xml = this.xmlBuilder.build(data)
    const pdf = await this.pdfService.render(data)

    const submissionId = newId()
    const xmlFile: DirectUploadFile = {
      buffer: Buffer.from(xml, 'utf8'),
      originalname: `${data.case.referenceNumber}-E2B-v${submissionNumber}.xml`,
      mimetype: 'application/xml',
    }
    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `${data.case.referenceNumber}-submission-v${submissionNumber}.pdf`,
      mimetype: 'application/pdf',
    }

    const xmlUpload = await this.documentsService.uploadDirect(
      actor,
      REGULATORY_SUBMISSION_RECORD_TYPE,
      submissionId,
      xmlFile,
      { title: 'E2B XML' },
      meta,
    )
    const pdfUpload = await this.documentsService.uploadDirect(
      actor,
      REGULATORY_SUBMISSION_RECORD_TYPE,
      submissionId,
      pdfFile,
      { title: 'Submission PDF' },
      meta,
    )

    // The final, fast, DB-only step — genuinely atomic (row creation +
    // its own audit entry together), unlike everything above it.
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.regulatorySubmission.create({
        data: {
          id: submissionId,
          companyId,
          caseId,
          submissionNumber,
          authorityId: submissionFormat.authorityId,
          reportable: reportability.reportable,
          reportabilityReason: reportability.reason,
          xmlDocumentId: xmlUpload.document.id,
          pdfDocumentId: pdfUpload.document.id,
          generatedBy: actor.sub,
          generatedAt: data.generatedAt,
        },
        include: {
          authority: { select: { id: true, code: true, name: true } },
          case: { select: { id: true, referenceNumber: true } },
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'regulatory_submission_generated',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        newValue: {
          submissionId,
          submissionNumber,
          authorityCode: submissionFormat.authority.code,
          reportable: reportability.reportable,
          reportabilityReason: reportability.reason,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(actor: AuthenticatedUser, caseId: string): Promise<RegulatorySubmissionWithMeta[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regulatorySubmission.findMany({
        where: { companyId, caseId },
        include: {
          authority: { select: { id: true, code: true, name: true } },
          case: { select: { id: true, referenceNumber: true } },
        },
        orderBy: { submissionNumber: 'desc' },
      }),
    )
  }

  async getDownloadUrl(
    actor: AuthenticatedUser,
    submissionId: string,
    artifact: 'xml' | 'pdf' | 'evidence',
  ): Promise<{ url: string }> {
    if (artifact !== 'xml' && artifact !== 'pdf' && artifact !== 'evidence') {
      throw new BadRequestException({
        code: 'INVALID_ARTIFACT',
        message: 'artifact must be one of "xml", "pdf", or "evidence"',
      })
    }

    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const submission = await tx.regulatorySubmission.findFirst({
        where: { id: submissionId, companyId },
      })
      if (!submission)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory submission not found',
        })

      const documentId =
        artifact === 'xml'
          ? submission.xmlDocumentId
          : artifact === 'pdf'
            ? submission.pdfDocumentId
            : submission.evidenceDocumentId
      if (!documentId)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `No ${artifact} document attached to this submission yet`,
        })

      const version = await tx.documentVersion.findFirst({
        where: { documentId },
        orderBy: { version: 'desc' },
      })
      if (!version)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document version not found' })

      return this.documentsService.getDownloadUrl(actor, documentId, version.id)
    })
  }

  /**
   * The "actually uploaded it to VigiFlow/PvERS outside this system, here's
   * proof" step — per Stage 12's own "No live PPB gateway integration"
   * scope note. Never itself transitions the case's workflow; the new
   * `(pv_case, submission_ready)` guard checks this row's own
   * `evidenceDocumentId` the moment someone actually clicks "Move to
   * Submitted" on the case detail page.
   */
  async attachEvidence(
    actor: AuthenticatedUser,
    submissionId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<RegulatorySubmission> {
    const companyId = requireCompany(actor)

    const submission = await this.rls.runAsCompany(companyId, (tx) =>
      tx.regulatorySubmission.findFirst({ where: { id: submissionId, companyId } }),
    )
    if (!submission)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Regulatory submission not found' })

    // Same reasoning as `generate()` — the real R2 upload is slow, network-
    // bound work that doesn't need a DB transaction held open around it.
    const upload = await this.documentsService.uploadDirect(
      actor,
      REGULATORY_SUBMISSION_RECORD_TYPE,
      submissionId,
      file,
      { title: 'Submission Evidence' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.regulatorySubmission.update({
        where: { id: submissionId },
        data: {
          evidenceDocumentId: upload.document.id,
          submittedAt: new Date(),
          submittedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'regulatory_submission_evidence_attached',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: submission.caseId,
        newValue: { submissionId, evidenceDocumentId: upload.document.id },
        ip: meta.ip,
      })

      return updated
    })
  }

  private async loadCaseData(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    authorityId: string,
    generatedByUserFullName: string,
  ): Promise<SubmissionCaseData> {
    const pvCase = await tx.case.findFirst({
      where: { id: caseId, companyId },
      include: {
        reportType: true,
        countryOfOccurrence: true,
        countryOfReport: true,
        reporter: true,
        patient: true,
        suspectProducts: {
          include: { whoDrugTerm: { include: { version: true } }, obtainedCountry: true },
        },
        adverseEvents: { include: { meddraTerm: { include: { version: true } } } },
      },
    })
    if (!pvCase) throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })

    const company = await tx.company.findFirstOrThrow({
      where: { id: companyId },
      include: { homeCountry: true },
    })
    const authority = await tx.regulatoryAuthority.findFirstOrThrow({ where: { id: authorityId } })

    return {
      case: pvCase,
      additionalInformation: pvCase.additionalInformationEncrypted
        ? this.textEncryption.decrypt(pvCase.additionalInformationEncrypted)
        : null,
      reportType: pvCase.reportType,
      countryOfOccurrence: pvCase.countryOfOccurrence,
      countryOfReport: pvCase.countryOfReport,
      reporter: pvCase.reporter,
      patient: pvCase.patient
        ? {
            ...pvCase.patient,
            medicalHistory: pvCase.patient.medicalHistoryEncrypted
              ? this.textEncryption.decrypt(pvCase.patient.medicalHistoryEncrypted)
              : null,
          }
        : null,
      suspectProducts: pvCase.suspectProducts,
      adverseEvents: pvCase.adverseEvents.map((ae) => ({
        ...ae,
        narrative: this.textEncryption.decrypt(ae.narrativeEncrypted),
      })),
      company,
      authority,
      generatedByUserFullName,
      submissionNumber: 0,
      generatedAt: new Date(),
    }
  }
}
