import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Pqr, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CapaService } from '../internal-audit/capa.service'
import { SignatureService } from '../signatures/signature.service'
import { TasksService } from '../tasks/tasks.service'
import { APQR_TIMEZONE_NOTE, ApqrHeader, buildApqrDocument } from './apqr-document'
import { toApqrXlsx } from './apqr-excel.util'
import { ApqrSnapshot, collectApqrSnapshot, defaultApqrPeriod, iso } from './apqr-sections'
import { AssemblePqrDto, ReviewPqrDto } from './dto/pqr.dto'
import { PqrPdfService } from './pqr-pdf.service'

export interface RequestMeta {
  ip?: string
}

/** Record type used for the APQR's own audit trail and tasks. Kept as `pqr` (the API path and table name are unchanged). */
export const PQR_RECORD_TYPE = 'pqr'
export const APQR_PDF_REPORT_TYPE = 'pqr'
export const APQR_XLSX_REPORT_TYPE = 'pqr_xlsx'
/** 🧭 ICH Q10's own annual-review cadence. */
const ANNUAL_REVIEW_MONTHS = 12

export type ApqrDownloadFormat = 'pdf' | 'xlsx'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Annual Product Quality Reviews are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/** The frozen assembly payload. Counts are kept at the top level for the existing list/detail UI. */
export interface AssembledData {
  batchCount: number
  deviationCount: number
  capaCount: number
  oosCount: number
  complaintCount: number
  changeControlCount: number
  regSubmissionCount: number
  regVariationCount: number
  recallCount: number
  openQualityTrendFlags: string[]
  stabilityNote: string
  snapshot: ApqrSnapshot
}

/**
 * QualCloud Stage 13 — Product Quality Review, renamed to Annual Product
 * Quality Review (APQR) in Phase 2 Pass C. `assemble()` freezes a full
 * cross-module snapshot onto the row (batches, deviations, CAPAs with
 * owners, OOS/OOT, complaints, change controls, recalls, returns, stability,
 * environmental monitoring, equipment, training, suppliers, regulatory). It
 * is never re-pulled. `review()` e-signs it and archives a PDF and an Excel
 * workbook as real `GeneratedReport` + `Document` rows; downloads return
 * those archived files, never a silent regeneration.
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
    const now = new Date()
    const defaults = defaultApqrPeriod(now)
    const periodStart = dto.periodStart ? new Date(dto.periodStart) : defaults.start
    const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : defaults.end
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException({
        code: 'PERIOD_INVALID',
        message: 'The period end must be on or after the period start.',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const snapshot = await collectApqrSnapshot(
        tx,
        companyId,
        dto.productId,
        periodStart,
        periodEnd,
        now,
      )

      // Stability note: the same honest wording as before, derived from the snapshot.
      const stabilityStudyCount = await tx.stabilityStudy.count({
        where: { companyId, productId: dto.productId },
      })
      let stabilityNote = 'Not yet applicable — no stability study exists for this product.'
      if (stabilityStudyCount > 0) {
        const recorded = snapshot.stability.filter(
          (t) => t.status === 'results_recorded' && t.pullDate,
        )
        if (recorded.length === 0) {
          stabilityNote = `${stabilityStudyCount} stability stud(y/ies) in progress — no timepoint results recorded in this period.`
        } else {
          const latest = recorded[recorded.length - 1]
          stabilityNote = latest.withinSpec
            ? `${stabilityStudyCount} stability stud(y/ies) on file — most recent recorded timepoint in the period (month ${latest.timepointMonths}) within specification.`
            : `${stabilityStudyCount} stability stud(y/ies) on file — most recent recorded timepoint in the period (month ${latest.timepointMonths}) OUT OF SPECIFICATION, review required.`
        }
      }

      const openFlags = await tx.qualityTrendFlag.findMany({
        where: { companyId, status: 'open' },
        select: { rootCauseCategory: true, occurrenceCount: true },
      })

      const assembled: AssembledData = {
        batchCount: snapshot.batches.length,
        deviationCount: snapshot.deviations.length,
        capaCount: snapshot.capas.length,
        oosCount: snapshot.oos.length,
        complaintCount: snapshot.complaints.length,
        changeControlCount: snapshot.changeControls.length,
        regSubmissionCount: snapshot.regulatory.filter((r) => r.kind === 'submission').length,
        regVariationCount: snapshot.regulatory.filter((r) => r.kind === 'variation').length,
        recallCount: snapshot.recalls.length,
        openQualityTrendFlags: openFlags.map(
          (f) => `${f.rootCauseCategory} (${f.occurrenceCount} occurrences)`,
        ),
        stabilityNote,
        snapshot,
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
          assembledData: assembled as unknown as Prisma.InputJsonValue,
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
        newValue: {
          productId: dto.productId,
          periodStart,
          periodEnd,
          periodSource: dto.periodStart || dto.periodEnd ? 'entered' : 'default_calendar_year_utc',
        },
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
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'APQR not found' })
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
   * The senior sign-off: records conclusions, trends and recommended actions
   * (each optionally opening a real CAPA), e-signs the record, then renders
   * and archives the PDF and the Excel workbook from the frozen snapshot.
   */
  async review(
    actor: AuthenticatedUser,
    id: string,
    dto: ReviewPqrDto,
    meta: RequestMeta,
  ): Promise<Pqr> {
    const companyId = requireCompany(actor)

    const { pqr, product, assembled } = await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.pqr.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'APQR not found' })
      if (existing.status === 'reviewed') {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'This APQR is already reviewed',
        })
      }
      const prod = await tx.product.findUnique({ where: { id: existing.productId } })
      return {
        pqr: existing,
        product: prod,
        assembled: existing.assembledData as unknown as AssembledData,
      }
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
              title: `APQR action — ${product?.brandName ?? pqr.productId}: ${action.description}`,
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

      if (updated.nextReviewDueAt) {
        await this.tasksService.escalateForRecord(
          companyId,
          PQR_RECORD_TYPE,
          id,
          'due_soon',
          `Next APQR for ${product?.brandName ?? pqr.productId} due`,
          {},
        )
      }

      return { updated, actionsOutcome }
    })

    const [reviewer, company] = await Promise.all([
      this.rls.runWithSystemAccess((tx) =>
        tx.user.findUnique({ where: { id: actor.sub }, select: { fullName: true } }),
      ),
      this.rls.runWithSystemAccess((tx) => tx.company.findUnique({ where: { id: companyId } })),
    ])

    const header: ApqrHeader = {
      companyName: company?.name ?? '',
      productName: product?.brandName ?? pqr.productId,
      periodStart: iso(pqr.periodStart) ?? '',
      periodEnd: iso(pqr.periodEnd) ?? '',
      periodNote: APQR_TIMEZONE_NOTE,
      generatedAt: new Date().toISOString(),
      reviewedByFullName: reviewer?.fullName ?? null,
      reviewedAt: iso(result.updated.reviewedAt),
      conclusionsNarrative: result.updated.conclusionsNarrative,
      trendsNarrative: result.updated.trendsNarrative,
      recommendedActions: result.actionsOutcome,
      stabilityNote: assembled.stabilityNote,
      openQualityTrendFlags: assembled.openQualityTrendFlags,
    }
    const model = buildApqrDocument(assembled.snapshot, header)

    // Rendering is slow and touches no database — it runs outside any open transaction.
    const [pdf, xlsx] = await Promise.all([this.pdfService.render(model), toApqrXlsx(model)])
    const title = `Annual Product Quality Review — ${header.productName}`

    const pdfReportId = await this.archive(actor, meta, companyId, {
      reportId: newId(),
      file: { buffer: pdf, originalname: 'apqr.pdf', mimetype: 'application/pdf' },
      reportTypeKey: APQR_PDF_REPORT_TYPE,
      title,
      pqr,
    })
    const xlsxReportId = await this.archive(actor, meta, companyId, {
      reportId: newId(),
      file: {
        buffer: xlsx,
        originalname: 'apqr.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      reportTypeKey: APQR_XLSX_REPORT_TYPE,
      title: `${title} (Excel)`,
      pqr,
    })

    return this.rls.runAsCompany(companyId, (tx) =>
      tx.pqr.update({
        where: { id },
        data: { generatedReportId: pdfReportId, excelGeneratedReportId: xlsxReportId },
      }),
    )
  }

  /**
   * Returns a short-lived download URL for the archived PDF or Excel file of
   * a signed APQR. Refuses while the APQR is still a draft, so nothing is ever
   * regenerated on demand.
   */
  async download(
    actor: AuthenticatedUser,
    id: string,
    format: ApqrDownloadFormat,
    meta: RequestMeta,
  ): Promise<{ url: string; filename: string }> {
    const companyId = requireCompany(actor)
    const pqr = await this.get(actor, id)
    if (pqr.status !== 'reviewed') {
      throw new ConflictException({
        code: 'APQR_NOT_SIGNED',
        message: 'The APQR can be downloaded once it has been reviewed and signed.',
      })
    }
    const reportId = format === 'pdf' ? pqr.generatedReportId : pqr.excelGeneratedReportId
    if (!reportId) {
      throw new ConflictException({
        code: 'ARCHIVE_MISSING',
        message: 'No archived file exists for this APQR.',
      })
    }

    const document = await this.rls.runAsCompany(companyId, (tx) =>
      tx.document.findFirst({
        where: { companyId, recordType: 'generated_report', recordId: reportId },
        include: {
          versions: { where: { status: 'stored' }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    )
    const version = document?.versions[0]
    if (!document || !version) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'The archived file could not be found.',
      })
    }

    const { url } = await this.documentsService.getDownloadUrl(actor, document.id, version.id)
    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'apqr_downloaded',
        recordType: PQR_RECORD_TYPE,
        recordId: id,
        newValue: { format, archivedReportId: reportId },
        ip: meta.ip,
      }),
    )
    return { url, filename: format === 'pdf' ? 'apqr.pdf' : 'apqr.xlsx' }
  }

  /** Archives one rendered file as a `GeneratedReport` (never overwritten). */
  private async archive(
    actor: AuthenticatedUser,
    meta: RequestMeta,
    companyId: string,
    input: {
      reportId: string
      file: DirectUploadFile
      reportTypeKey: string
      title: string
      pqr: Pqr
    },
  ): Promise<string> {
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      input.reportId,
      input.file,
      { title: input.title },
      meta,
    )
    await this.rls.runAsCompany(companyId, (tx) =>
      tx.generatedReport.create({
        data: {
          id: input.reportId,
          companyId,
          moduleKey: 'qualcloud',
          reportTypeKey: input.reportTypeKey,
          title: input.title,
          periodStart: input.pqr.periodStart,
          periodEnd: input.pqr.periodEnd,
          recordType: 'product',
          recordId: input.pqr.productId,
          status: 'final',
          generatedBy: actor.sub,
        },
      }),
    )
    return input.reportId
  }
}
