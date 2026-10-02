import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { BatchRecordReview } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { SignatureService } from '../signatures/signature.service'
import { CreateBatchRecordReviewDto } from './dto/create-batch-record-review.dto'
import { RecordBatchDispositionDto } from './dto/record-batch-disposition.dto'

export interface RequestMeta {
  ip?: string
}

export const BATCH_RECORD_REVIEW_RECORD_TYPE = 'batch_record_review'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Batch record reviews are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 7 — the *pre*-Qualified-Person batch-record
 * review. `recordDisposition()` reuses the existing electronic-signature
 * engine directly (`SignatureService`, the same one
 * `ClinicalTrialService.revealTreatmentArm()` already uses) rather than
 * a full generic workflow instance — this is a single-shot review
 * action, not a multi-state lifecycle, so there is no
 * `WorkflowDefinition` for this record type. Stage 17's own QP release
 * is a separate, later, more senior gate for manufacturers that need
 * it — never conflated with this one.
 */
@Injectable()
export class BatchRecordReviewService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly signatureService: SignatureService,
  ) {}

  async listForBatch(actor: AuthenticatedUser, batchId: string): Promise<BatchRecordReview[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.batchRecordReview.findMany({
        where: { companyId, batchId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<BatchRecordReview> {
    const companyId = requireCompany(actor)
    const found = await this.rls.runAsCompany(companyId, (tx) =>
      tx.batchRecordReview.findFirst({ where: { id, companyId } }),
    )
    if (!found)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch record review not found' })
    return found
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateBatchRecordReviewDto,
    meta: RequestMeta,
  ): Promise<BatchRecordReview> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id: dto.batchId, companyId } })
      if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      if (dto.mbrDocumentId) {
        const document = await tx.document.findFirst({
          where: { id: dto.mbrDocumentId, companyId },
        })
        if (!document)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'MBR document not found' })
      }

      const created = await tx.batchRecordReview.create({
        data: {
          id: newId(),
          companyId,
          batchId: dto.batchId,
          mbrDocumentId: dto.mbrDocumentId ?? null,
          reviewerUserId: actor.sub,
          reviewFindings: dto.reviewFindings ?? null,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_record_review_created',
        recordType: BATCH_RECORD_REVIEW_RECORD_TYPE,
        recordId: created.id,
        newValue: { batchId: dto.batchId },
        ip: meta.ip,
      })

      return created
    })
  }

  /**
   * The real QA disposition — `released | rejected | reworked` —
   * e-signature-gated, and the direct write path to `Batch.qualityStatus`
   * (alongside `OosService.recordPhase2()`'s own `batch_rejected`/
   * `batch_reworked` path and the Recall module's own `recalled` write).
   */
  async recordDisposition(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordBatchDispositionDto,
    meta: RequestMeta,
  ): Promise<BatchRecordReview> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.batchRecordReview.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch record review not found' })
      if (existing.disposition) {
        throw new ConflictException({
          code: 'ALREADY_DISPOSITIONED',
          message: 'This batch record review already has a recorded disposition',
        })
      }

      await this.signatureService.sign(
        tx,
        actor,
        {
          recordType: BATCH_RECORD_REVIEW_RECORD_TYPE,
          recordId: id,
          intentStatement: dto.intentStatement,
          signatureToken: dto.signatureToken,
          roleAtSigning: actor.roleKeys[0] ?? 'unknown',
          canonicalPayload: {
            batchRecordReviewId: id,
            batchId: existing.batchId,
            disposition: dto.disposition,
          },
        },
        meta,
      )

      const updated = await tx.batchRecordReview.update({
        where: { id },
        data: { disposition: dto.disposition, dispositionedAt: new Date() },
      })

      await tx.batch.update({
        where: { id: existing.batchId },
        data: { qualityStatus: dto.disposition },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_record_review_dispositioned',
        recordType: BATCH_RECORD_REVIEW_RECORD_TYPE,
        recordId: id,
        newValue: { disposition: dto.disposition, batchId: existing.batchId },
        ip: meta.ip,
      })

      return updated
    })
  }
}
