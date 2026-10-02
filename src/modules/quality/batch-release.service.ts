import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { BatchReleaseDecision, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { SignatureService } from '../signatures/signature.service'
import { ReleaseBatchDto } from './dto/release-batch.dto'

export interface RequestMeta {
  ip?: string
}

export const BATCH_RELEASE_RECORD_TYPE = 'batch_release_decision'

export interface ReleaseReadinessItem {
  key: string
  label: string
  passed: boolean
  recordType?: string
  recordId?: string
  detail?: string
}

export interface ReleaseReadiness {
  batchId: string
  qualityStatus: string
  allPassed: boolean
  items: ReleaseReadinessItem[]
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Batch release is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 17 — Batch Release (Qualified Person). A
 * distinct, more senior gate than Stage 7's `BatchRecordReviewService`
 * (QA batch-record review/disposition) — never conflated with it.
 * Deliberately modeled as a permission-only gate
 * (`quality.manage_batch_release`, seeded since Stage 0, granted to no
 * role by this pass — see this class's own doc comment at the bottom):
 * real-world Qualified Person designation is a jurisdiction-specific
 * professional credential, not something this schema invents a role or
 * certification table for.
 *
 * `getReadiness()` computes, live, every one of the three real
 * preconditions — a reviewed/released `BatchRecordReview`, every linked
 * `Deviation`/`Oos`/`Complaint` closed-or-risk-accepted, and (reported
 * separately, by the controller's own permission gate) that the acting
 * user actually holds `quality.manage_batch_release` — so the frontend
 * can show a clear pass/fail per item *before* the signature step is
 * ever offered, matching this project's own documented "show which
 * role/condition is actually required" UX lesson (see CLAUDE.md's own
 * `WorkflowActionsPanel` gotcha).
 *
 * `riskAcceptances` on `ReleaseBatchDto` is a plain `{recordType,
 * recordId, reason}` array, evaluated only at release time — a
 * deliberate, narrowly-scoped choice over retrofitting a risk-acceptance
 * column onto `Deviation`/`Oos`/`Complaint` (three separate pre-existing
 * models), matching this schema's own "don't build ahead of a confirmed
 * need" discipline. Every risk acceptance is permanently recorded on the
 * resulting `BatchReleaseDecision` row — never silently discarded.
 */
@Injectable()
export class BatchReleaseService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly signatureService: SignatureService,
  ) {}

  async getReadiness(actor: AuthenticatedUser, batchId: string): Promise<ReleaseReadiness> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id: batchId, companyId } })
      if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      const items: ReleaseReadinessItem[] = []

      const review = await tx.batchRecordReview.findFirst({
        where: { batchId, companyId, disposition: 'released' },
        orderBy: { createdAt: 'desc' },
      })
      items.push({
        key: 'batch_record_review',
        label: 'A QA batch-record review has disposed this batch as "released"',
        passed: Boolean(review),
        detail: review ? undefined : 'No reviewed-and-released BatchRecordReview exists for this batch yet',
      })

      const [deviations, oosRecords, complaints] = await Promise.all([
        tx.deviation.findMany({ where: { batchId, companyId } }),
        tx.oos.findMany({ where: { batchId, companyId } }),
        tx.complaint.findMany({ where: { batchId, companyId } }),
      ])

      for (const d of deviations) {
        items.push({
          key: `quality_deviation:${d.id}`,
          label: `Deviation ${d.deviationNumber}`,
          passed: Boolean(d.closedAt),
          recordType: 'quality_deviation',
          recordId: d.id,
          detail: d.closedAt ? undefined : 'Open — must be closed, or risk-accepted at release',
        })
      }
      for (const o of oosRecords) {
        items.push({
          key: `quality_oos:${o.id}`,
          label: `OOS/OOT ${o.oosNumber}`,
          passed: Boolean(o.closedAt),
          recordType: 'quality_oos',
          recordId: o.id,
          detail: o.closedAt ? undefined : 'Open — must be closed, or risk-accepted at release',
        })
      }
      for (const c of complaints) {
        items.push({
          key: `quality_complaint:${c.id}`,
          label: `Complaint ${c.complaintNumber}`,
          passed: Boolean(c.resolvedAt),
          recordType: 'quality_complaint',
          recordId: c.id,
          detail: c.resolvedAt ? undefined : 'Unresolved — must be resolved, or risk-accepted at release',
        })
      }

      const alreadyReleased = await tx.batchReleaseDecision.findFirst({ where: { batchId, companyId } })
      items.push({
        key: 'not_already_decided',
        label: 'No release decision has been recorded for this batch yet',
        passed: !alreadyReleased,
        detail: alreadyReleased ? `Already decided "${alreadyReleased.decision}" on a prior release` : undefined,
      })

      return {
        batchId,
        qualityStatus: batch.qualityStatus,
        allPassed: items.every((i) => i.passed),
        items,
      }
    })
  }

  async release(
    actor: AuthenticatedUser,
    batchId: string,
    dto: ReleaseBatchDto,
    meta: RequestMeta,
  ): Promise<BatchReleaseDecision> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const batch = await tx.batch.findFirst({ where: { id: batchId, companyId } })
      if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      const existingDecision = await tx.batchReleaseDecision.findFirst({ where: { batchId, companyId } })
      if (existingDecision) {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: 'A batch release decision has already been recorded for this batch',
        })
      }

      const review = await tx.batchRecordReview.findFirst({
        where: { batchId, companyId, disposition: 'released' },
        orderBy: { createdAt: 'desc' },
      })
      if (!review) {
        throw new ConflictException({
          code: 'BATCH_RECORD_REVIEW_REQUIRED',
          message: 'This batch has no reviewed-and-released BatchRecordReview yet — a QA review must happen first',
        })
      }

      const acceptedKeys = new Set(dto.riskAcceptances.map((r) => `${r.recordType}:${r.recordId}`))

      const [deviations, oosRecords, complaints] = await Promise.all([
        tx.deviation.findMany({ where: { batchId, companyId } }),
        tx.oos.findMany({ where: { batchId, companyId } }),
        tx.complaint.findMany({ where: { batchId, companyId } }),
      ])

      const unresolved: string[] = []
      for (const d of deviations) {
        if (!d.closedAt && !acceptedKeys.has(`quality_deviation:${d.id}`)) unresolved.push(d.deviationNumber)
      }
      for (const o of oosRecords) {
        if (!o.closedAt && !acceptedKeys.has(`quality_oos:${o.id}`)) unresolved.push(o.oosNumber)
      }
      for (const c of complaints) {
        if (!c.resolvedAt && !acceptedKeys.has(`quality_complaint:${c.id}`)) unresolved.push(c.complaintNumber)
      }
      if (unresolved.length > 0) {
        throw new ConflictException({
          code: 'OPEN_QUALITY_EVENTS',
          message: `The following linked quality events must be closed, or explicitly risk-accepted: ${unresolved.join(', ')}`,
        })
      }

      const signature = await this.signatureService.sign(
        tx,
        actor,
        {
          recordType: BATCH_RELEASE_RECORD_TYPE,
          recordId: batchId,
          intentStatement: dto.intentStatement,
          signatureToken: dto.signatureToken,
          roleAtSigning: actor.roleKeys[0] ?? 'unknown',
          canonicalPayload: { batchId, decision: dto.decision, riskAcceptances: dto.riskAcceptances },
        },
        meta,
      )

      const decision = await tx.batchReleaseDecision.create({
        data: {
          id: newId(),
          companyId,
          batchId,
          batchRecordReviewId: review.id,
          decision: dto.decision,
          riskAcceptances: dto.riskAcceptances as unknown as Prisma.InputJsonValue,
          signatureEventId: signature.id,
          releasedByUserId: actor.sub,
        },
      })

      await tx.batch.update({ where: { id: batchId }, data: { qualityStatus: dto.decision } })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_release_decided',
        recordType: BATCH_RELEASE_RECORD_TYPE,
        recordId: decision.id,
        newValue: { batchId, decision: dto.decision, riskAcceptanceCount: dto.riskAcceptances.length },
        ip: meta.ip,
      })

      return decision
    })
  }

  async listForBatch(actor: AuthenticatedUser, batchId: string): Promise<BatchReleaseDecision[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.batchReleaseDecision.findMany({ where: { batchId, companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }
}

/**
 * Open decision, documented per the build instruction: `quality.manage_batch_release`
 * has existed, seeded, since QualCloud Stage 0 and is deliberately
 * granted to no tenant role in `rbac.seed-data.ts` — `todo-qualcloud.md`
 * itself names this Qualified-Person-only, and real-world QP
 * designation is a jurisdiction-specific professional credential this
 * project does not invent a role for. A company that needs this gate
 * live today must have its own `super_admin`/platform operator grant
 * `quality.manage_batch_release` to a specific user's own role via the
 * existing RBAC Admin Console (`PATCH /rbac-admin/roles/:key/permissions`)
 * — deliberately not pre-decided here.
 */
