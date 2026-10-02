import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Pqr, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CapaService } from '../internal-audit/capa.service'
import { SignatureService } from '../signatures/signature.service'
import { TasksService } from '../tasks/tasks.service'
import { AssemblePqrDto, ReviewPqrDto } from './dto/pqr.dto'
import { PqrPdfService } from './pqr-pdf.service'

export interface RequestMeta {
  ip?: string
}

export const PQR_RECORD_TYPE = 'pqr'
/** 🧭 ICH Q10's own annual-review cadence — the only one this stage's own build spec names, matching `ProductReviewReminderService`'s/`ManagementReviewReminderService`'s own coded-default precedent. */
const ANNUAL_REVIEW_MONTHS = 12

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Product Quality Reviews are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

interface AssembledData {
  batchCount: number
  deviationCount: number
  capaCount: number
  oosCount: number
  complaintCount: number
  changeControlCount: number
  regSubmissionCount: number
  regVariationCount: number
  openQualityTrendFlags: string[]
  stabilityNote: string
}

/**
 * QualCloud (Phase 13) Stage 13 — Product Quality Review & Quality Risk
 * Management. `assemble()` pulls a real, live cross-module snapshot
 * (batches, deviations/CAPAs/OOS, complaints, changes, regulatory
 * activity, open trend flags) and freezes it onto the row — the same
 * "contemporaneous snapshot, never re-pulled" discipline
 * `ManagementReviewService` already established for its own frozen
 * metrics. Stability data (`stabilityNote`) is now real — Stage 19
 * (Environmental Monitoring & Stability Programme) built the
 * `StabilityStudy`/`StabilityTimepoint` models this field's own prior
 * doc comment named as the gap; a product with no stability study on
 * file still honestly degrades to "not yet applicable," matching
 * `RuleResolutionService`'s own null-for-unconfirmed-cases precedent —
 * never a fabricated number. `review()` reuses `SignatureService`
 * directly (the
 * same single-shot e-signature pattern `BatchRecordReviewService
 * .recordDisposition()` already established) — a PQR review is one
 * senior sign-off action, not a multi-state workflow.
 */
@Injectable()
export class PqrService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly signatureService: SignatureService,
    private readonly capaService: CapaService,
    private readonly tasksService: TasksService,
    private readonly pdfService: PqrPdfService,
  ) {}

  async assemble(actor: AuthenticatedUser, dto: AssemblePqrDto, meta: RequestMeta): Promise<Pqr> {
    const companyId = requireCompany(actor)
    const periodStart = new Date(dto.periodStart)
    const periodEnd = new Date(dto.periodEnd)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const periodWhere = { gte: periodStart, lte: periodEnd }

      const [
        batchCount,
        deviationRows,
        complaintCount,
        changeControlCount,
        oosCount,
        regSubmissionCount,
        regVariationCount,
        openFlags,
      ] = await Promise.all([
        tx.batch.count({ where: { companyId, productId: dto.productId, manufacturedOn: periodWhere } }),
        tx.deviation.findMany({
          where: { companyId, productId: dto.productId, detectedAt: periodWhere },
          select: { id: true },
        }),
        tx.complaint.count({ where: { companyId, productId: dto.productId, createdAt: periodWhere } }),
        tx.changeControl.count({
          where: { companyId, productId: dto.productId, createdAt: periodWhere },
        }),
        tx.oos.count({
          where: {
            companyId,
            createdAt: periodWhere,
            batch: { productId: dto.productId },
          },
        }),
        tx.regSubmission.count({
          where: { companyId, createdAt: periodWhere, regDossier: { productId: dto.productId } },
        }),
        tx.regVariation.count({
          where: { companyId, createdAt: periodWhere, regDossier: { productId: dto.productId } },
        }),
        tx.qualityTrendFlag.findMany({ where: { companyId, status: 'open' }, select: { rootCauseCategory: true, occurrenceCount: true } }),
      ])

      // QualCloud Stage 19 — real stability data now that the module
      // exists, closing the gap this field's own doc comment named.
      // Queried directly against the same `tx`, matching every other
      // cross-module count above (never a nested call into
      // `StabilityService`, which would open its own transaction).
      const stabilityStudies = await tx.stabilityStudy.findMany({
        where: { companyId, productId: dto.productId },
        include: { timepoints: { orderBy: { pullDate: 'desc' } } },
      })
      let stabilityNote = 'Not yet applicable — no stability study exists for this product.'
      if (stabilityStudies.length > 0) {
        const recordedTimepoints = stabilityStudies
          .flatMap((s) => s.timepoints)
          .filter((t) => t.status === 'results_recorded' && t.pullDate)
          .sort((a, b) => (b.pullDate as Date).getTime() - (a.pullDate as Date).getTime())
        stabilityNote =
          recordedTimepoints.length === 0
            ? `${stabilityStudies.length} stability stud(y/ies) in progress — no timepoint results recorded yet.`
            : recordedTimepoints[0].withinSpec
              ? `${stabilityStudies.length} stability stud(y/ies) on file — most recent recorded timepoint (month ${recordedTimepoints[0].timepointMonths}) within specification.`
              : `${stabilityStudies.length} stability stud(y/ies) on file — most recent recorded timepoint (month ${recordedTimepoints[0].timepointMonths}) OUT OF SPECIFICATION, review required.`
      }

      const deviationIds = deviationRows.map((d) => d.id)
      const capaCount =
        deviationIds.length > 0
          ? await tx.capa.count({
              where: {
                companyId,
                sourceRecordType: 'deviation',
                sourceRecordId: { in: deviationIds },
                createdAt: periodWhere,
              },
            })
          : 0

      const assembledData: AssembledData = {
        batchCount,
        deviationCount: deviationIds.length,
        capaCount,
        oosCount,
        complaintCount,
        changeControlCount,
        regSubmissionCount,
        regVariationCount,
        openQualityTrendFlags: openFlags.map(
          (f) => `${f.rootCauseCategory} (${f.occurrenceCount} occurrences)`,
        ),
        stabilityNote,
      }

      const nextReviewDueAt = new Date(periodEnd)
      nextReviewDueAt.setUTCMonth(nextReviewDueAt.getUTCMonth() + ANNUAL_REVIEW_MONTHS)

      const created = await tx.pqr.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          periodStart,
          periodEnd,
          status: 'draft',
          assembledData: assembledData as unknown as Prisma.InputJsonValue,
          nextReviewDueAt,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'pqr_assembled',
        recordType: PQR_RECORD_TYPE,
        recordId: created.id,
        newValue: { productId: dto.productId, periodStart, periodEnd },
        ip: meta.ip,
      })

      return created
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Pqr> {
    const companyId = requireCompany(actor)
    const found = await this.rls.runAsCompany(companyId, (tx) =>
      tx.pqr.findFirst({ where: { id, companyId } }),
    )
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'PQR not found' })
    return found
  }

  async list(actor: AuthenticatedUser, productId?: string): Promise<Pqr[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.pqr.findMany({
        where: { companyId, ...(productId ? { productId } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  /**
   * The real senior sign-off: records the human judgment layer
   * (conclusions, trends, recommended actions — each optionally opening
   * a real `Capa` via `createFrom('pqr_action', ...)`), e-signs it, and
   * generates+archives the real PDF via the existing `GeneratedReport`
   * pattern (`DocumentsService.uploadDirect()`, matching
   * `PeriodicReportService.generate()`'s own exact shape).
   */
  async review(actor: AuthenticatedUser, id: string, dto: ReviewPqrDto, meta: RequestMeta): Promise<Pqr> {
    const companyId = requireCompany(actor)

    const { pqr, product, assembled } = await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.pqr.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'PQR not found' })
      if (existing.status === 'reviewed') {
        throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'This PQR is already reviewed' })
      }
      const prod = await tx.product.findUnique({ where: { id: existing.productId } })
      return { pqr: existing, product: prod, assembled: existing.assembledData as unknown as AssembledData }
    })

    const result = await this.rls.runAsCompany(companyId, async (tx) => {
      await this.signatureService.sign(
        tx,
        actor,
        {
          recordType: PQR_RECORD_TYPE,
          recordId: id,
          intentStatement: dto.intentStatement,
          signatureToken: dto.signatureToken,
          roleAtSigning: actor.roleKeys[0] ?? 'unknown',
          canonicalPayload: {
            pqrId: id,
            productId: pqr.productId,
            periodStart: pqr.periodStart,
            periodEnd: pqr.periodEnd,
          },
        },
        meta,
      )

      const recommendedActions = dto.recommendedActions ?? []
      const actionsOutcome: { description: string; capaOpened: boolean }[] = []
      for (const action of recommendedActions) {
        let capaOpened = false
        if (action.openCapa) {
          await this.capaService.createFrom(
            tx,
            actor,
            companyId,
            'pqr_action',
            id,
            {
              title: `PQR action — ${product?.brandName ?? pqr.productId}: ${action.description}`,
              correctiveAction: action.description,
              ownerUserId: action.ownerUserId,
              rootCauseCategory: action.rootCauseCategory,
            },
            meta,
          )
          capaOpened = true
        }
        actionsOutcome.push({ description: action.description, capaOpened })
      }

      const updated = await tx.pqr.update({
        where: { id },
        data: {
          status: 'reviewed',
          conclusionsNarrative: dto.conclusionsNarrative ?? null,
          trendsNarrative: dto.trendsNarrative ?? null,
          recommendedActions: actionsOutcome,
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'pqr_reviewed',
        recordType: PQR_RECORD_TYPE,
        recordId: id,
        newValue: { capasOpened: actionsOutcome.filter((a) => a.capaOpened).length },
        ip: meta.ip,
      })

      // A reminder task for the next cycle — mirrors every other
      // annual/periodic reminder's own "a Task is the due-ness signal,
      // not a parallel tracking column" precedent.
      if (updated.nextReviewDueAt) {
        await this.tasksService.escalateForRecord(
          companyId,
          PQR_RECORD_TYPE,
          id,
          'due_soon',
          `Next PQR for ${product?.brandName ?? pqr.productId} due`,
          {},
        )
      }

      return { updated, actionsOutcome }
    })

    const reviewer = await this.rls.runWithSystemAccess((tx) =>
      tx.user.findUnique({ where: { id: actor.sub }, select: { fullName: true } }),
    )

    const pdf = await this.pdfService.render({
      companyName: (await this.rls.runWithSystemAccess((tx) => tx.company.findUnique({ where: { id: companyId } })))
        ?.name ?? '',
      productName: product?.brandName ?? pqr.productId,
      periodStart: pqr.periodStart,
      periodEnd: pqr.periodEnd,
      batchCount: assembled.batchCount,
      deviationCount: assembled.deviationCount,
      capaCount: assembled.capaCount,
      oosCount: assembled.oosCount,
      complaintCount: assembled.complaintCount,
      changeControlCount: assembled.changeControlCount,
      regSubmissionCount: assembled.regSubmissionCount,
      regVariationCount: assembled.regVariationCount,
      openQualityTrendFlags: assembled.openQualityTrendFlags,
      stabilityNote: assembled.stabilityNote,
      conclusionsNarrative: result.updated.conclusionsNarrative,
      trendsNarrative: result.updated.trendsNarrative,
      recommendedActions: result.actionsOutcome,
      reviewedByFullName: reviewer?.fullName ?? null,
      reviewedAt: result.updated.reviewedAt,
      generatedAt: new Date(),
    })

    const reportId = newId()
    const file: DirectUploadFile = {
      buffer: pdf,
      originalname: 'pqr.pdf',
      mimetype: 'application/pdf',
    }
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      file,
      { title: `Product Quality Review — ${product?.brandName ?? pqr.productId}` },
      meta,
    )

    const finalPqr = await this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'qualcloud',
          reportTypeKey: 'pqr',
          title: `Product Quality Review — ${product?.brandName ?? pqr.productId}`,
          periodStart: pqr.periodStart,
          periodEnd: pqr.periodEnd,
          recordType: 'product',
          recordId: pqr.productId,
          status: 'final',
          generatedBy: actor.sub,
        },
      })
      return tx.pqr.update({ where: { id }, data: { generatedReportId: report.id } })
    })

    return finalPqr
  }
}
