import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, RiskManagementPlan } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { AttachRmpDocumentDto } from './dto/attach-rmp-document.dto'
import { CreateRmpDto } from './dto/create-rmp.dto'
import { UpdateRmpContentDto } from './dto/update-rmp-content.dto'
import { UpdateRmpRenewalDto } from './dto/update-rmp-renewal.dto'
import { RmpContent, RmpPdfService } from './rmp-pdf.service'

export interface RequestMeta {
  ip?: string
}

export const RMP_RECORD_TYPE = 'risk_management_plan'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A Risk Management Plan is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 18 — per-product RMP, version-on-write exactly like
 * `PsmfService` (see that service's own doc comment for the shared
 * reasoning) — the one structural difference is the partial unique
 * index scoping to `productId`, not `companyId`, since a company can
 * have many products each with their own independent RMP lifecycle.
 * `nextRenewalDueAt` is a plain, directly-editable field (via
 * `updateRenewal()`, callable regardless of draft/active/retired status)
 * rather than something this service derives — an RMP's real renewal
 * cadence is a regulatory judgment call, not a fixed formula.
 */
@Injectable()
export class RiskManagementPlanService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly pdfService: RmpPdfService,
    private readonly documentsService: DocumentsService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateRmpDto,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
      }

      const latest = await tx.riskManagementPlan.findFirst({
        where: { productId: dto.productId },
        orderBy: { version: 'desc' },
      })
      const nextVersion = (latest?.version ?? 0) + 1

      const created = await tx.riskManagementPlan.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          version: nextVersion,
          title: dto.title,
          summary: dto.summary ?? null,
          nextRenewalDueAt: dto.nextRenewalDueAt ? new Date(dto.nextRenewalDueAt) : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_draft_created',
        recordType: RMP_RECORD_TYPE,
        recordId: created.id,
        newValue: { productId: created.productId, version: created.version, title: created.title },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachDocument(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachRmpDocumentDto,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.riskManagementPlan.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'RMP draft not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft RMP can have its document changed',
        })
      }

      const document = await tx.document.findFirst({
        where: { id: dto.documentId, companyId, recordType: RMP_RECORD_TYPE, recordId: id },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message:
            'Document not found for this RMP — upload it first via the generic documents endpoint',
        })
      }

      const updated = await tx.riskManagementPlan.update({
        where: { id },
        data: { documentId: dto.documentId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_document_attached',
        recordType: RMP_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Real-document-fidelity request, 12 Sep 2026 — the "create from
   * scratch" half of RMP generation, mirroring `PsmfService.updateContent()`
   * exactly: saves the draft's own structured content — the actual RMP
   * being filled in section by section, matching `Drat Kenya
   * RMP.docx`'s own 6-part shape — without touching `documentId` at all.
   */
  async updateContent(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRmpContentDto,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.riskManagementPlan.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'RMP draft not found' })
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft RMP can have its content edited',
        })
      }

      const updated = await tx.riskManagementPlan.update({
        where: { id },
        data: { content: dto.content as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_content_updated',
        recordType: RMP_RECORD_TYPE,
        recordId: id,
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Real-document-fidelity request, 12 Sep 2026 — renders a real PDF
   * from the draft's own saved `content` (via `RmpPdfService`) and
   * attaches it exactly the way `attachDocument()` attaches a
   * manually-uploaded one, mirroring `PsmfService.generateDocument()`'s
   * own slow-work-outside-transaction shape.
   */
  async generateDocument(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    const [existing, company, product] = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.riskManagementPlan.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'RMP draft not found' })
      }
      if (found.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft RMP can have a document generated for it',
        })
      }
      const companyRow = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      })
      const productRow = await tx.product.findUniqueOrThrow({
        where: { id: found.productId },
        select: { brandName: true },
      })
      return [found, companyRow, productRow] as const
    })

    const pdf = await this.pdfService.render({
      companyName: company.name,
      productBrandName: product.brandName,
      version: existing.version,
      status: existing.status,
      createdAt: existing.createdAt,
      content: (existing.content ?? {}) as RmpContent,
    })

    const pdfFile: DirectUploadFile = {
      buffer: pdf,
      originalname: `rmp-v${existing.version}-${new Date().toISOString().slice(0, 10)}.pdf`,
      mimetype: 'application/pdf',
    }
    const upload = await this.documentsService.uploadDirect(
      actor,
      RMP_RECORD_TYPE,
      id,
      pdfFile,
      { title: `RMP v${existing.version}` },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.riskManagementPlan.update({
        where: { id },
        data: { documentId: upload.document.id },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_document_generated',
        recordType: RMP_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: upload.document.id },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** A draft RMP with no document attached can never be activated — mirrors `PsmfService.activate()`'s own enforcement. */
  async activate(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const target = await tx.riskManagementPlan.findFirst({ where: { id, companyId } })
      if (!target) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'RMP draft not found' })
      }
      if (target.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_A_DRAFT',
          message: 'Only a draft RMP can be activated',
        })
      }
      if (!target.documentId) {
        throw new ConflictException({
          code: 'DOCUMENT_REQUIRED',
          message: 'Attach an RMP document before activating this version',
        })
      }

      const previousActive = await tx.riskManagementPlan.findFirst({
        where: { productId: target.productId, status: 'active' },
      })
      if (previousActive) {
        await tx.riskManagementPlan.update({
          where: { id: previousActive.id },
          data: { status: 'retired', retiredAt: new Date() },
        })
      }

      const activated = await tx.riskManagementPlan.update({
        where: { id },
        data: { status: 'active', activatedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_activated',
        recordType: RMP_RECORD_TYPE,
        recordId: id,
        oldValue: previousActive ? { previousActiveVersion: previousActive.version } : undefined,
        newValue: { productId: activated.productId, version: activated.version },
        ip: meta.ip,
      })

      return activated
    })
  }

  async updateRenewal(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRmpRenewalDto,
    meta: RequestMeta,
  ): Promise<RiskManagementPlan> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.riskManagementPlan.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'RMP not found' })
      }

      const updated = await tx.riskManagementPlan.update({
        where: { id },
        data: { nextRenewalDueAt: new Date(dto.nextRenewalDueAt) },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'rmp_renewal_date_updated',
        recordType: RMP_RECORD_TYPE,
        recordId: id,
        oldValue: { nextRenewalDueAt: existing.nextRenewalDueAt },
        newValue: { nextRenewalDueAt: updated.nextRenewalDueAt },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser, productId?: string): Promise<RiskManagementPlan[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      return tx.riskManagementPlan.findMany({
        where: { companyId, ...(productId ? { productId } : {}) },
        orderBy: [{ productId: 'asc' }, { version: 'desc' }],
      })
    })
  }

  /** Renewals due within the next 90 days, or already overdue — used by `DashboardService`. */
  async countRenewalsDue(companyId: string): Promise<number> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const horizon = new Date()
      horizon.setDate(horizon.getDate() + 90)
      return tx.riskManagementPlan.count({
        where: { companyId, status: 'active', nextRenewalDueAt: { lte: horizon } },
      })
    })
  }
}
