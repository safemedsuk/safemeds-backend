import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { SourceDocument } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { LinkSourceDocumentDto } from './dto/link-source-document.dto'
import { MarkRedactedDto } from './dto/mark-redacted.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Stage 1's `SourceDocument` — a thin, PV-specific link between an
 * already-uploaded base-engine `Document` (Phase 8's own three-step
 * upload handshake, `recordType: "pv_case"`) and the `Case` it's the
 * original artifact for, plus PV-specific redaction metadata that
 * `Document` itself has no reason to carry. Never uploads bytes itself —
 * the document must already exist and have a `stored` version before it
 * can be linked here.
 */
@Injectable()
export class SourceDocumentService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async link(
    actor: AuthenticatedUser,
    caseId: string,
    dto: LinkSourceDocumentDto,
    meta: RequestMeta,
  ): Promise<SourceDocument> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const pvCase = await tx.case.findFirst({ where: { id: caseId, companyId } })
      if (!pvCase) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const document = await tx.document.findFirst({
        where: { id: dto.documentId, companyId, recordType: PV_CASE_RECORD_TYPE, recordId: caseId },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message:
            'No document uploaded against this case with that ID — upload via POST /records/pv_case/:caseId/documents first',
        })
      }

      const existing = await tx.sourceDocument.findFirst({
        where: { caseId, documentId: dto.documentId },
      })
      if (existing) {
        return existing
      }

      const created = await tx.sourceDocument.create({
        data: {
          id: newId(),
          companyId,
          caseId,
          documentId: dto.documentId,
          redactionApplied: false,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_source_document_linked',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return created
    })
  }

  /**
   * VigiCloud Stage 3.4 — the same link as `link()`, for
   * `WhatsAppIntakeService`'s system-channel packaging-photo attachment
   * (no logged-in human actor). `SourceDocument` itself carries no
   * `createdBy` column, so only the audit entry's `actorType` needs to
   * change, not the row shape.
   */
  async linkSystem(
    companyId: string,
    caseId: string,
    documentId: string,
    meta: RequestMeta,
  ): Promise<SourceDocument> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const pvCase = await tx.case.findFirst({ where: { id: caseId, companyId } })
      if (!pvCase) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const document = await tx.document.findFirst({
        where: { id: documentId, companyId, recordType: PV_CASE_RECORD_TYPE, recordId: caseId },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'No document uploaded against this case with that ID',
        })
      }

      const existing = await tx.sourceDocument.findFirst({ where: { caseId, documentId } })
      if (existing) {
        return existing
      }

      const created = await tx.sourceDocument.create({
        data: { id: newId(), companyId, caseId, documentId, redactionApplied: false },
      })

      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'pv_source_document_linked',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        newValue: { documentId },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(actor: AuthenticatedUser, caseId: string): Promise<SourceDocument[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, (tx) =>
      tx.sourceDocument.findMany({ where: { caseId, companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  /**
   * VigiCloud Stage 3.7 — "a flag + a redacted-copy upload slot, distinct
   * from the original." `dto.redactedDocumentId`, when given, must
   * already be a real `Document` uploaded against this same case (the
   * same handshake `link()` itself requires for the original) — this
   * method never uploads bytes, only links what's already there. The
   * flag alone (no redacted copy) remains valid, matching the previous
   * behavior exactly for any caller that doesn't supply one.
   */
  async markRedacted(
    actor: AuthenticatedUser,
    id: string,
    dto: MarkRedactedDto,
    meta: RequestMeta,
  ): Promise<SourceDocument> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.sourceDocument.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Source document link not found',
        })
      }
      if (existing.redactionApplied) {
        return existing
      }

      if (dto.redactedDocumentId) {
        const redactedDocument = await tx.document.findFirst({
          where: {
            id: dto.redactedDocumentId,
            companyId,
            recordType: PV_CASE_RECORD_TYPE,
            recordId: existing.caseId,
          },
        })
        if (!redactedDocument) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message:
              'No document uploaded against this case with that ID — upload the redacted copy first',
          })
        }
      }

      const redactedAt = new Date()
      const updated = await tx.sourceDocument.update({
        where: { id },
        data: {
          redactionApplied: true,
          redactedBy: actor.sub,
          redactedAt,
          redactedDocumentId: dto.redactedDocumentId ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_source_document_redacted',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: existing.caseId,
        oldValue: { redactionApplied: false },
        newValue: { redactionApplied: true, redactedDocumentId: dto.redactedDocumentId ?? null },
        ip: meta.ip,
      })

      return updated
    })
  }
}
