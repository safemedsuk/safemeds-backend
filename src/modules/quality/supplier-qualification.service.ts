import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CertificateOfAnalysis, Prisma, SupplierQuestionnaire } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { InternalAuditService } from '../internal-audit/internal-audit.service'
import { TasksService } from '../tasks/tasks.service'
import {
  ApproveSupplierDto,
  AssessSupplierDto,
  CreateCoaDto,
  MonitorSupplierDto,
  ReviewCoaDto,
  ScheduleSupplierAuditDto,
} from './dto/supplier-qualification.dto'

export interface RequestMeta {
  ip?: string
}

export const SUPPLIER_RECORD_TYPE = 'supplier'

/** 🧭 WHO GMP's own commonly-cited annual/2–3-year split — coded defaults, admin-editable via `Company.supplierCriticalRequalificationMonths`/`supplierNonCriticalRequalificationMonths` (both nullable, null means "use this default"). */
const DEFAULT_CRITICAL_REQUALIFICATION_MONTHS = 12
const DEFAULT_NON_CRITICAL_REQUALIFICATION_MONTHS = 30

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Supplier qualification is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Best-effort pass/fail against a `SpecificationParameter`'s own
 * `lowerLimit`/`upperLimit` — numeric comparison when both the result
 * and the limits parse as numbers (the common case for an assay/purity
 * result), falling back to a case-insensitive exact-text match for a
 * genuinely qualitative criterion (e.g. "complies," "white to
 * off-white powder"), matching `SpecificationParameter.lowerLimit`'s
 * own doc comment on why this column can't be forced numeric. Mirrors
 * `OosService`'s own "a result either structurally passes or fails its
 * own parameter" framing, applied here to incoming-material CoA review
 * rather than a finished-product OOS.
 */
/** Pass B (item D3) — the biennial supplier performance review cadence. */
export const BIENNIAL_REVIEW_MONTHS = 24

function addMonths(date: Date, months: number): Date {
  const out = new Date(date)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

function evaluateResult(
  resultValue: string,
  lowerLimit: string | null,
  upperLimit: string | null,
): boolean {
  const numericResult = Number(resultValue)
  if (!Number.isNaN(numericResult) && (lowerLimit !== null || upperLimit !== null)) {
    const lower = lowerLimit !== null ? Number(lowerLimit) : null
    const upper = upperLimit !== null ? Number(upperLimit) : null
    if ((lower === null || !Number.isNaN(lower)) && (upper === null || !Number.isNaN(upper))) {
      if (lower !== null && numericResult < lower) return false
      if (upper !== null && numericResult > upper) return false
      return true
    }
  }
  // Qualitative fallback — a non-null limit (upper or lower column,
  // whichever is set) is treated as the expected text value.
  const expected = (lowerLimit ?? upperLimit)?.trim().toLowerCase()
  if (!expected) return true
  return resultValue.trim().toLowerCase() === expected
}

/**
 * QualCloud (Phase 13) Stage 11 — Supplier & Material Qualification.
 * Builds directly on `SupplierService`'s existing bare CRUD (Stage 0.1)
 * rather than duplicating it — this service owns the real qualification
 * *lifecycle* (structured questionnaire assessment, qualification-audit
 * scheduling, the approve/suspend/disqualify decision, ongoing
 * performance monitoring) plus incoming-material/API CoA review.
 * `scheduleAudit()` reuses `InternalAuditService` directly
 * (`auditScope: 'supplier'`), never a parallel audit-scheduling
 * mechanism — matching this project's own "the generic engine, not a
 * per-domain re-implementation" discipline. The "Approved Supplier
 * List" is deliberately **not** a new table — `list({ approvalStatus:
 * 'approved' })` on the existing `SupplierService` already is that
 * list; this service only adds the write-side lifecycle around it.
 */
@Injectable()
export class SupplierQualificationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly internalAuditService: InternalAuditService,
    private readonly tasksService: TasksService,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * Pass B (item D1) — the supplier's GMP certificate, uploaded against the
   * supplier record. `approve()` refuses to approve a supplier that has none,
   * so the requirement is enforced in the service, not only the UI.
   */
  async attachGmpCertificate(
    actor: AuthenticatedUser,
    supplierId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    const supplierName = await this.requireSupplierName(companyId, supplierId)
    const uploaded = await this.documentsService.uploadDirect(
      actor,
      SUPPLIER_RECORD_TYPE,
      supplierId,
      file,
      { title: `GMP certificate — ${supplierName}` },
      meta,
    )
    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: { gmpCertificateDocumentId: uploaded.document.id },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_gmp_certificate_attached',
        recordType: SUPPLIER_RECORD_TYPE,
        recordId: supplierId,
        newValue: { documentId: uploaded.document.id, filename: file.originalname },
        ip: meta.ip,
      })
      return updated
    })
  }

  /**
   * Pass B (item D2) — uploads the biennial review checklist and returns its
   * document id. `monitor()` then attaches it to the review record it creates.
   */
  async uploadReviewChecklist(
    actor: AuthenticatedUser,
    supplierId: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<{ documentId: string }> {
    const companyId = requireCompany(actor)
    const supplierName = await this.requireSupplierName(companyId, supplierId)
    const uploaded = await this.documentsService.uploadDirect(
      actor,
      SUPPLIER_RECORD_TYPE,
      supplierId,
      file,
      {
        title: `Supplier review checklist — ${supplierName} — ${new Date().toISOString().slice(0, 10)}`,
      },
      meta,
    )
    return { documentId: uploaded.document.id }
  }

  async listReviews(actor: AuthenticatedUser, supplierId: string) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.requireSupplierName(companyId, supplierId)
      return tx.supplierPerformanceReview.findMany({
        where: { companyId, supplierId },
        include: { checklistDocument: { select: { id: true, title: true } } },
        orderBy: { reviewedAt: 'desc' },
      })
    })
  }

  private async requireSupplierName(companyId: string, supplierId: string): Promise<string> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.supplier.findFirst({
        where: { id: supplierId, companyId },
        select: { name: true },
      })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })
      return found.name
    })
  }

  private async getRequalificationMonths(
    tx: Prisma.TransactionClient,
    companyId: string,
    criticality: string,
  ): Promise<number> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: {
        supplierCriticalRequalificationMonths: true,
        supplierNonCriticalRequalificationMonths: true,
      },
    })
    if (criticality === 'critical') {
      return (
        company?.supplierCriticalRequalificationMonths ?? DEFAULT_CRITICAL_REQUALIFICATION_MONTHS
      )
    }
    return (
      company?.supplierNonCriticalRequalificationMonths ??
      DEFAULT_NON_CRITICAL_REQUALIFICATION_MONTHS
    )
  }

  async assess(
    actor: AuthenticatedUser,
    supplierId: string,
    dto: AssessSupplierDto,
    meta: RequestMeta,
  ): Promise<SupplierQuestionnaire> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, companyId } })
      if (!supplier)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })

      const totalWeight = dto.criteria.reduce((sum, c) => sum + c.weight, 0)
      const weightedScore = dto.criteria.reduce((sum, c) => sum + c.weight * c.score, 0)
      // Normalized to a 0–100 scale — weight × score (0–10) against the
      // maximum possible (weight × 10), summed across criteria.
      const overallScore =
        totalWeight > 0 ? Math.round((weightedScore / (totalWeight * 10)) * 100) : null

      const created = await tx.supplierQuestionnaire.create({
        data: {
          id: newId(),
          companyId,
          supplierId,
          title: dto.title,
          criteria: dto.criteria as unknown as Prisma.InputJsonValue,
          overallScore,
          assessedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_assessed',
        recordType: SUPPLIER_RECORD_TYPE,
        recordId: supplierId,
        newValue: { questionnaireId: created.id, overallScore },
        ip: meta.ip,
      })

      return created
    })
  }

  async listQuestionnaires(
    actor: AuthenticatedUser,
    supplierId: string,
  ): Promise<SupplierQuestionnaire[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.supplierQuestionnaire.findMany({
        where: { companyId, supplierId },
        orderBy: { assessedAt: 'desc' },
      }),
    )
  }

  /** Opens a real `InternalAudit` (`auditScope: 'supplier'`) against this supplier — reuses Stage 9's own service directly, never a parallel scheduling mechanism. */
  async scheduleAudit(
    actor: AuthenticatedUser,
    supplierId: string,
    dto: ScheduleSupplierAuditDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    const supplier = await this.rls.runAsCompany(companyId, (tx) =>
      tx.supplier.findFirst({ where: { id: supplierId, companyId } }),
    )
    if (!supplier) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })

    return this.internalAuditService.create(
      actor,
      {
        title: `Supplier qualification audit — ${supplier.name}`,
        auditScope: 'supplier',
        supplierId,
        scheduledDate: dto.scheduledDate,
        leadAuditorUserId: dto.leadAuditorUserId,
      },
      meta,
    )
  }

  /** The sign-off decision — `approved | suspended | disqualified` — writes `Supplier.approvalStatus` and, on approval, computes the live re-qualification due date. */
  async approve(
    actor: AuthenticatedUser,
    supplierId: string,
    dto: ApproveSupplierDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { id: supplierId, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })
      // Pass B (item D1): approval needs the supplier's GMP certificate on file.
      if (dto.approvalStatus === 'approved' && !existing.gmpCertificateDocumentId) {
        throw new ConflictException({
          code: 'GMP_CERTIFICATE_REQUIRED',
          message: "Upload the supplier's GMP certificate before approving this supplier.",
        })
      }

      const now = new Date()
      let nextRequalificationDueAt = existing.nextRequalificationDueAt
      let lastQualifiedAt = existing.lastQualifiedAt
      if (dto.approvalStatus === 'approved') {
        const months = await this.getRequalificationMonths(tx, companyId, existing.criticality)
        const due = new Date(now)
        due.setUTCMonth(due.getUTCMonth() + months)
        nextRequalificationDueAt = due
        lastQualifiedAt = now
      }

      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: {
          approvalStatus: dto.approvalStatus,
          nextRequalificationDueAt,
          lastQualifiedAt,
          ...(dto.note
            ? {
                performanceFlags: {
                  push: `[${now.toISOString()}] ${dto.approvalStatus}: ${dto.note}`,
                },
              }
            : {}),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_approval_decided',
        recordType: SUPPLIER_RECORD_TYPE,
        recordId: supplierId,
        oldValue: { approvalStatus: existing.approvalStatus },
        newValue: { approvalStatus: dto.approvalStatus, nextRequalificationDueAt },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Appends a timestamped performance flag — the running log `monitor()`'s own doc comment describes. */
  async monitor(
    actor: AuthenticatedUser,
    supplierId: string,
    dto: MonitorSupplierDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.supplier.findFirst({ where: { id: supplierId, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })
      const checklist = await tx.document.findFirst({
        where: {
          id: dto.checklistDocumentId,
          companyId,
          recordType: SUPPLIER_RECORD_TYPE,
          recordId: supplierId,
        },
      })
      if (!checklist) {
        throw new BadRequestException({
          code: 'CHECKLIST_NOT_FOUND',
          message: 'Upload the review checklist for this supplier first, then record the review.',
        })
      }

      const now = new Date()
      const entry = `[${now.toISOString()}] ${dto.flag}`
      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: { performanceFlags: { push: entry } },
      })
      // Pass B (item D2/D3): every review is its own record. The next biennial
      // review is due 24 months after this one.
      const nextReviewDueAt = addMonths(now, BIENNIAL_REVIEW_MONTHS)
      await tx.supplierPerformanceReview.create({
        data: {
          id: newId(),
          companyId,
          supplierId,
          checklistDocumentId: checklist.id,
          performanceFlags: [dto.flag],
          notes: dto.notes ?? null,
          reviewedBy: actor.sub,
          reviewedAt: now,
          nextReviewDueAt,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'supplier_performance_flagged',
        recordType: SUPPLIER_RECORD_TYPE,
        recordId: supplierId,
        newValue: { flag: dto.flag, checklistDocumentId: checklist.id, nextReviewDueAt },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** The live "Approved Supplier List" — a filtered read, never a second table, over `nextRequalificationDueAt` as well so a caller can also see who's coming due. */
  async listApproved(actor: AuthenticatedUser) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.supplier.findMany({
        where: { companyId, approvalStatus: 'approved', isActive: true },
        orderBy: { nextRequalificationDueAt: 'asc' },
      }),
    )
  }

  // ── Incoming-material/API Certificate of Analysis review ──────────────

  async createCoa(
    actor: AuthenticatedUser,
    dto: CreateCoaDto,
    meta: RequestMeta,
  ): Promise<CertificateOfAnalysis> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: dto.supplierId, companyId },
      })
      if (!supplier)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Supplier not found' })

      const spec = await tx.specification.findFirst({
        where: { id: dto.materialSpecificationId, companyId },
        include: { parameters: true },
      })
      if (!spec)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Material specification not found',
        })
      if (!['raw_material', 'api'].includes(spec.specificationType)) {
        throw new BadRequestException({
          code: 'NOT_A_MATERIAL_SPECIFICATION',
          message: 'A CoA must reference a raw_material or api specification',
        })
      }

      const results = dto.results.map((r) => {
        const param = spec.parameters.find((p) => p.id === r.parameterId)
        const pass = param
          ? evaluateResult(r.resultValue, param.lowerLimit, param.upperLimit)
          : false
        return { ...r, pass }
      })
      const allPass = results.every((r) => r.pass)

      const created = await tx.certificateOfAnalysis.create({
        data: {
          id: newId(),
          companyId,
          supplierId: dto.supplierId,
          materialSpecificationId: dto.materialSpecificationId,
          batchOrLotNumber: dto.batchOrLotNumber,
          results: results,
          disposition: allPass ? 'accepted' : 'quarantined',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'coa_recorded',
        recordType: 'certificate_of_analysis',
        recordId: created.id,
        newValue: { supplierId: dto.supplierId, disposition: created.disposition, allPass },
        ip: meta.ip,
      })

      return created
    })
  }

  async listCoa(actor: AuthenticatedUser, supplierId?: string): Promise<CertificateOfAnalysis[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.certificateOfAnalysis.findMany({
        where: { companyId, ...(supplierId ? { supplierId } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  /** A human reviewer confirms (or overrides) the computed disposition — never silently auto-finalized without this step for a `rejected`/`quarantined` result. */
  async reviewCoa(
    actor: AuthenticatedUser,
    id: string,
    dto: ReviewCoaDto,
    meta: RequestMeta,
  ): Promise<CertificateOfAnalysis> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.certificateOfAnalysis.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CoA not found' })
      if (existing.reviewedAt) {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'This CoA is already reviewed',
        })
      }

      const updated = await tx.certificateOfAnalysis.update({
        where: { id },
        data: { disposition: dto.disposition, reviewedBy: actor.sub, reviewedAt: new Date() },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'coa_reviewed',
        recordType: 'certificate_of_analysis',
        recordId: id,
        newValue: { disposition: dto.disposition },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** The daily re-qualification-due scan — companies with suppliers past `nextRequalificationDueAt` get a Task escalation, mirroring every other overdue-scan job in this codebase. Called from `SupplierRequalificationProcessor`. */
  async escalateDueRequalifications(): Promise<{ suppliersEscalated: number }> {
    const now = new Date()
    const dueSuppliers = await this.rls.runWithSystemAccess((tx) =>
      tx.supplier.findMany({
        where: {
          isActive: true,
          approvalStatus: 'approved',
          nextRequalificationDueAt: { lt: now },
        },
        select: { id: true, companyId: true, name: true },
      }),
    )

    for (const supplier of dueSuppliers) {
      await this.tasksService.escalateForRecord(
        supplier.companyId,
        SUPPLIER_RECORD_TYPE,
        supplier.id,
        'overdue',
        `Supplier re-qualification overdue: ${supplier.name}`,
        {},
      )
    }

    return { suppliersEscalated: dueSuppliers.length }
  }
}
