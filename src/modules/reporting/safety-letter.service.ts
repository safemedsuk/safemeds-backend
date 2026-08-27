import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { GeneratedReport, SafetyLetterRecipient } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { NotificationsService } from '../notifications/notifications.service'
import { GenerateSafetyLetterDto } from './dto/generate-safety-letter.dto'
import { SAFETY_ALERT_RECORD_TYPE } from './safety-alert.service'
import { SafetyLetterPdfService } from './safety-letter-pdf.service'

export interface RequestMeta {
  ip?: string
}

export interface SafetyLetterWithRecipients extends GeneratedReport {
  recipients: SafetyLetterRecipient[]
}

const LETTER_TITLES: Record<'dhcp' | 'dil', string> = {
  dhcp: 'Dear Healthcare Professional Letter',
  dil: 'Dear Investigator Letter',
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A safety letter is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 18 — a DHCP/DIL letter is "generation, not a new
 * distribution channel" per the build spec's own text: the letter
 * itself is a real PDF (`SafetyLetterPdfService`, pdfkit) stored the
 * usual way (`GeneratedReport` + polymorphic `Document`), and dispatch
 * reuses the exact same `NotificationsService.sendExternalEmail()` Stage
 * 11/16 already use for external, non-`User` recipients — no new mailer,
 * queue, or processor. Slow work (PDF render, R2 upload) deliberately
 * sits outside any open transaction, matching the Stage 12 precedent
 * `RegulatorySubmissionService` established for the identical shape.
 */
@Injectable()
export class SafetyLetterService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: SafetyLetterPdfService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    dto: GenerateSafetyLetterDto,
    meta: RequestMeta,
  ): Promise<SafetyLetterWithRecipients> {
    const companyId = requireCompany(actor)

    const { alert, company, productName } = await this.rls.runAsCompany(companyId, async (tx) => {
      const alert = await tx.safetyAlert.findFirst({ where: { id: dto.safetyAlertId, companyId } })
      if (!alert) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Safety alert not found' })
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })

      let productName: string | null = null
      if (dto.productId) {
        const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
        if (!product) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
        }
        productName = product.brandName
      }

      return { alert, company, productName }
    })

    const signatoryTitle = dto.signatoryTitle?.trim() || 'Medical Director / QPPV'
    const generatedAt = new Date()
    const pdf = await this.pdfService.render({
      letterType: dto.letterType,
      companyName: company.name,
      productName,
      alertTitle: alert.title,
      alertSummary: alert.summary,
      ppbApprovalReference: dto.ppbApprovalReference,
      backgroundInformation: dto.backgroundInformation,
      actionableGuidance: dto.actionableGuidance,
      signatoryName: dto.signatoryName,
      signatoryTitle,
      regulatoryContactEmail: company.regulatoryContactEmail,
      regulatoryContactPhone: company.regulatoryContactPhone,
      registeredAddress: company.registeredAddress,
      generatedAt,
    })

    const reportId = newId()
    const letterFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `${dto.letterType}-letter.pdf`,
      mimetype: 'application/pdf',
    }
    const letterUpload = await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      letterFile,
      { title: LETTER_TITLES[dto.letterType] },
      meta,
    )

    const { report, recipients } = await this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'pv',
          reportTypeKey: `${dto.letterType}_letter`,
          title: `${LETTER_TITLES[dto.letterType]} — ${alert.title}`,
          recordType: SAFETY_ALERT_RECORD_TYPE,
          recordId: alert.id,
          status: 'final',
          generatedBy: actor.sub,
          content: {
            ppbApprovalReference: dto.ppbApprovalReference,
            backgroundInformation: dto.backgroundInformation,
            actionableGuidance: dto.actionableGuidance,
            signatoryName: dto.signatoryName,
            signatoryTitle,
          },
        },
      })

      const recipients = await Promise.all(
        dto.recipients.map((r) =>
          tx.safetyLetterRecipient.create({
            data: {
              id: newId(),
              companyId,
              generatedReportId: report.id,
              recipientName: r.name,
              recipientEmail: r.email,
            },
          }),
        ),
      )

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'safety_letter_generated',
        recordType: 'generated_report',
        recordId: report.id,
        newValue: {
          letterType: dto.letterType,
          safetyAlertId: alert.id,
          recipientCount: recipients.length,
          documentId: letterUpload.document.id,
        },
        ip: meta.ip,
      })

      return { report, recipients }
    })

    return { ...report, recipients }
  }

  /** Dispatches (or re-dispatches) the letter to every recipient who hasn't yet been marked sent. */
  async dispatch(
    actor: AuthenticatedUser,
    generatedReportId: string,
    meta: RequestMeta,
  ): Promise<SafetyLetterWithRecipients> {
    const companyId = requireCompany(actor)

    const { report, pending, bodyText } = await this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.findFirst({
        where: { id: generatedReportId, companyId },
      })
      if (!report) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Generated report not found' })
      }
      const pending = await tx.safetyLetterRecipient.findMany({
        where: { generatedReportId, companyId, sentAt: null },
      })

      // testing-todo Stage 18.2 — the dispatch email used to be one bare
      // sentence naming only the report title, with no real content at
      // all. Pulls the actual alert this letter was generated against
      // (`report.recordId`, set at `generate()` time) for a real
      // company/product/summary-bearing body — this is "generation, not
      // a new distribution channel" (Stage 18's own scoping note) still
      // honored: no attachment, no app link a non-account recipient
      // couldn't use anyway, just real content instead of a placeholder.
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      })
      const alert = report.recordId
        ? await tx.safetyAlert.findFirst({
            where: { id: report.recordId, companyId },
            include: { affectedProduct: { select: { brandName: true } } },
          })
        : null
      const letterKind =
        report.reportTypeKey === 'dhcp_letter'
          ? 'Dear Healthcare Professional Letter'
          : 'Dear Investigator Letter'
      const bodyLines = [
        `${company.name} has issued a ${letterKind}${alert?.affectedProduct ? ` concerning ${alert.affectedProduct.brandName}` : ''}.`,
        alert ? `\n${alert.title}\n\n${alert.summary}` : '',
        '\nThis notice is issued in accordance with pharmacovigilance safety-communication requirements. Please contact the company directly with any questions.',
      ]
      const bodyText = bodyLines.filter(Boolean).join('\n')

      return { report, pending, bodyText }
    })

    for (const recipient of pending) {
      await this.notificationsService.sendExternalEmail(
        recipient.recipientEmail,
        report.title,
        bodyText,
      )
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const now = new Date()
      await tx.safetyLetterRecipient.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { sentAt: now },
      })

      if (pending.length > 0) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'safety_letter_dispatched',
          recordType: 'generated_report',
          recordId: generatedReportId,
          newValue: { recipientCount: pending.length },
          ip: meta.ip,
        })
      }

      const recipients = await tx.safetyLetterRecipient.findMany({
        where: { generatedReportId, companyId },
      })
      return { ...report, recipients }
    })
  }

  async get(
    actor: AuthenticatedUser,
    generatedReportId: string,
  ): Promise<SafetyLetterWithRecipients> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.findFirst({
        where: { id: generatedReportId, companyId },
      })
      if (!report) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Generated report not found' })
      }
      const recipients = await tx.safetyLetterRecipient.findMany({
        where: { generatedReportId, companyId },
        orderBy: { createdAt: 'asc' },
      })
      return { ...report, recipients }
    })
  }
}
