import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallSubmission } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { RecallSubmissionPdfService } from './recall-submission-pdf.service'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall submission is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export const RECALL_SUBMISSION_RECORD_TYPE = 'recall_submission'

/**
 * QualCloud (Phase 13) Stage 10.1 — the tenant-side half of the recall
 * country rules engine: generating one real, versioned
 * `RecallSubmission` from a `RecallSubmissionTemplate` for a specific
 * `RecallCountry`. Reuses the already-proven "render outside any DB
 * transaction, then a short transaction to record the result"
 * discipline `RegulatorySubmissionService` established (Phase 11 Stage
 * 12) — a PDF render and a real R2 upload are both slow, non-DB work
 * that must never hold a Postgres transaction open around them.
 */
@Injectable()
export class RecallSubmissionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly pdfService: RecallSubmissionPdfService,
  ) {}

  async list(actor: AuthenticatedUser, recallCountryId: string): Promise<RecallSubmission[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallSubmission.findMany({
        where: { companyId, recallCountryId },
        orderBy: { generatedAt: 'desc' },
      }),
    )
  }

  async generate(
    actor: AuthenticatedUser,
    recallCountryId: string,
    templateId: string,
    meta: RequestMeta,
  ): Promise<RecallSubmission> {
    const companyId = requireCompany(actor)

    const { country, template, recall, countryRow } = await this.rls.runAsCompany(
      companyId,
      async (tx) => {
        const recallCountry = await tx.recallCountry.findFirst({
          where: { id: recallCountryId, companyId },
        })
        if (!recallCountry) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })
        }
        const submissionTemplate = await tx.recallSubmissionTemplate.findUnique({
          where: { id: templateId },
        })
        if (!submissionTemplate || submissionTemplate.ruleSetId !== recallCountry.ruleSetId) {
          throw new ConflictException({
            code: 'TEMPLATE_MISMATCH',
            message: 'This template does not belong to this country’s own live rule-set',
          })
        }
        const recallRow = await tx.recall.findUniqueOrThrow({
          where: { id: recallCountry.recallId },
          include: { product: { select: { brandName: true } } },
        })
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { name: true },
        })
        const country = await tx.country.findUniqueOrThrow({
          where: { id: recallCountry.countryId },
          select: { name: true },
        })
        return {
          country: recallCountry,
          template: submissionTemplate,
          recall: { ...recallRow, companyName: company.name },
          countryRow: country,
        }
      },
    )

    const pdf = await this.pdfService.render({
      templateName: template.name,
      companyName: recall.companyName,
      recallRef: recall.ref ?? recall.id,
      productName: recall.product.brandName,
      reason: recall.reason,
      countryName: countryRow.name,
      generatedAt: new Date(),
    })

    const file: DirectUploadFile = {
      buffer: pdf,
      originalname: `${template.code}-v${template.format === 'pdf' ? 1 : 1}-${new Date()
        .toISOString()
        .slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    const upload = await this.documentsService.uploadDirect(
      actor,
      RECALL_SUBMISSION_RECORD_TYPE,
      country.id,
      file,
      { title: template.name },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.recallSubmission.create({
        data: {
          id: newId(),
          companyId,
          recallCountryId: country.id,
          templateId: template.id,
          templateVersion: 1,
          documentId: upload.document.id,
          status: 'draft',
          generatedBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_submission_generated',
        recordType: RECALL_SUBMISSION_RECORD_TYPE,
        recordId: created.id,
        newValue: { recallCountryId: country.id, templateCode: template.code },
        ip: meta.ip,
      })
      return created
    })
  }

  async markSubmitted(
    actor: AuthenticatedUser,
    submissionId: string,
    submittedProofDocumentId: string,
    meta: RequestMeta,
  ): Promise<RecallSubmission> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallSubmission.findFirst({
        where: { id: submissionId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall submission not found' })
      }
      const updated = await tx.recallSubmission.update({
        where: { id: submissionId },
        data: { status: 'submitted', submittedProofDocumentId },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_submission_marked_submitted',
        recordType: RECALL_SUBMISSION_RECORD_TYPE,
        recordId: submissionId,
        ip: meta.ip,
      })
      return updated
    })
  }
}
