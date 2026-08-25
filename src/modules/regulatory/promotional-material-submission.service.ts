import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PromotionalMaterialSubmission } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { WorkflowService } from '../workflow/workflow.service'
import { AttachPromotionalMaterialDocumentDto } from './dto/attach-promotional-material-document.dto'
import { CreatePromotionalMaterialSubmissionDto } from './dto/create-promotional-material-submission.dto'
import { ListPromotionalMaterialSubmissionsQueryDto } from './dto/list-promotional-material-submissions-query.dto'

export interface RequestMeta {
  ip?: string
}

export type PromotionalMaterialSubmissionWithDetail = PromotionalMaterialSubmission & {
  product: { brandName: string }
  authority: { name: string; code: string }
  workflowInstanceId: string | null
  transitionHistory: TransitionLogEntry[]
}

export interface TransitionLogEntry {
  fromStateKey: string | null
  toStateKey: string
  note: string | null
  actorName: string | null
  occurredAt: Date
}

/**
 * RegCloud (Phase 12) Stage 13 — the workflow's own record type. Mirrors
 * `REG_REGISTRATION_RECORD_TYPE`/`SIGNAL_RECORD_TYPE`'s own precedent —
 * must always agree with `PROMOTIONAL_MATERIAL_WORKFLOW_RECORD_TYPE` in
 * `prisma/workflow.seed-data.ts` (both are the literal string
 * `"promotional_material"`).
 */
export const PROMOTIONAL_MATERIAL_RECORD_TYPE = 'promotional_material'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A promotional material submission is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 13 — Advertising & Promotion. Deliberately a
 * lighter-weight CRUD + workflow record than the master registration
 * lifecycle — no query/response loop (see `PromotionalMaterialWorkflowGuards`'s
 * own doc comment for why this is a considered scope decision), just
 * create → attach the actual material → submit → approve/reject, with the
 * real transition mechanics handled entirely by the generic
 * `POST /workflow/instances/:id/transition` endpoint, exactly like
 * `pv_case`/`signal`/`reg_registration`.
 */
@Injectable()
export class PromotionalMaterialSubmissionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListPromotionalMaterialSubmissionsQueryDto,
  ): Promise<PaginatedResult<PromotionalMaterialSubmissionWithDetail>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId, ...(query.productId ? { productId: query.productId } : {}) }
      const [rows, total] = await Promise.all([
        tx.promotionalMaterialSubmission.findMany({
          where,
          include: {
            product: { select: { brandName: true } },
            authority: { select: { name: true, code: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.promotionalMaterialSubmission.count({ where }),
      ])
      // List view doesn't need the per-row workflow/history detail (same
      // "cheap list, richer get()" split `RegDossierService` established).
      const withDetail = rows.map((r) => ({
        ...r,
        workflowInstanceId: null,
        transitionHistory: [],
      }))
      return paginate(withDetail, total, query)
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<PromotionalMaterialSubmissionWithDetail> {
    const companyId = requireCompany(actor)
    const submission = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.promotionalMaterialSubmission.findFirst({
        where: { id, companyId },
        include: {
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
        },
      })
      if (!found)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Promotional material submission not found',
        })

      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: PROMOTIONAL_MATERIAL_RECORD_TYPE, recordId: id },
        include: { currentState: true },
      })

      return {
        ...found,
        status: workflowInstance?.currentState.stateKey ?? found.status,
        workflowInstanceId: workflowInstance?.id ?? null,
      }
    })

    const historyPage = await this.auditService.query(actor, {
      recordType: PROMOTIONAL_MATERIAL_RECORD_TYPE,
      recordId: id,
      action: 'state_change',
      page: 1,
      limit: 50,
    })
    const transitionHistory: TransitionLogEntry[] = historyPage.data.map((entry) => {
      const oldValue = entry.oldValue as { stateKey?: string } | null
      const newValue = entry.newValue as { stateKey?: string; note?: string } | null
      return {
        fromStateKey: oldValue?.stateKey ?? null,
        toStateKey: newValue?.stateKey ?? '',
        note: newValue?.note ?? null,
        actorName: entry.actorName,
        occurredAt: entry.occurredAt,
      }
    })

    return { ...submission, transitionHistory }
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreatePromotionalMaterialSubmissionDto,
    meta: RequestMeta,
  ): Promise<PromotionalMaterialSubmissionWithDetail> {
    const companyId = requireCompany(actor)

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const authority = await tx.regulatoryAuthority.findUnique({ where: { id: dto.authorityId } })
      if (!authority)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory authority not found',
        })

      if (dto.materialDocumentId) {
        // RLS on `document` (company-scoped) means a cross-tenant id simply resolves to nothing.
        const document = await tx.document.findUnique({ where: { id: dto.materialDocumentId } })
        if (!document)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found' })
      }

      const row = await tx.promotionalMaterialSubmission.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          authorityId: dto.authorityId,
          materialType: dto.materialType,
          materialDocumentId: dto.materialDocumentId,
          status: 'draft',
          createdBy: actor.sub,
        },
      })

      await this.workflowService.instantiate(
        actor,
        PROMOTIONAL_MATERIAL_RECORD_TYPE,
        row.id,
        authority.countryId,
        meta,
      )

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'promotional_material_submission_created',
        recordType: PROMOTIONAL_MATERIAL_RECORD_TYPE,
        recordId: row.id,
        newValue: {
          productId: dto.productId,
          authorityId: dto.authorityId,
          materialType: dto.materialType,
          materialDocumentId: dto.materialDocumentId ?? null,
        },
        ip: meta.ip,
      })

      return row.id
    })

    return this.get(actor, created)
  }

  async attachMaterialDocument(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachPromotionalMaterialDocumentDto,
    meta: RequestMeta,
  ): Promise<PromotionalMaterialSubmissionWithDetail> {
    const companyId = requireCompany(actor)

    await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.promotionalMaterialSubmission.findFirst({
        where: { id, companyId },
      })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Promotional material submission not found',
        })

      const document = await tx.document.findUnique({ where: { id: dto.documentId } })
      if (!document)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Document not found' })

      await tx.promotionalMaterialSubmission.update({
        where: { id },
        data: { materialDocumentId: dto.documentId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'promotional_material_document_attached',
        recordType: PROMOTIONAL_MATERIAL_RECORD_TYPE,
        recordId: id,
        newValue: { materialDocumentId: dto.documentId },
        ip: meta.ip,
      })
    })

    return this.get(actor, id)
  }
}
