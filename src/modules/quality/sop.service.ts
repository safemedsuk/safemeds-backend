import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, Sop } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { WorkflowService } from '../workflow/workflow.service'
import { DocumentNumberingService } from './document-numbering.service'
import { CreateSopDto } from './dto/create-sop.dto'
import { ListSopsQueryDto } from './dto/list-sops-query.dto'
import { UpdateSopDto } from './dto/update-sop.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * QualCloud (Phase 13) Stage 1 — the real Draft→Review&Approve→
 * Effective→(Superseded|Retired) lifecycle's own record type, matching
 * `workflow.seed-data.ts`'s `QUALITY_CONTROLLED_DOCUMENT_WORKFLOW_RECORD_TYPE`
 * exactly.
 */
export const QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE = 'quality_controlled_document'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Controlled documents are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 0.1/0.2/1 — the controlled-document register.
 * `create()` now instantiates a real `quality_controlled_document`
 * `WorkflowInstance` (Stage 1) alongside the row; every state transition
 * from there on goes through the generic
 * `POST /workflow/instances/:id/transition` endpoint (no bespoke
 * transition wrapper here, matching `PvCaseService`'s own established
 * "the generic engine, not a per-domain re-implementation" precedent) —
 * `QualityWorkflowGuards` owns the actual lifecycle side effects
 * (effective-date stamping, superseding the prior version, the
 * never-self-approve guard). `update()` stays bare-CRUD, gated to
 * `status === 'draft'` exactly as Stage 0 left it — the real lifecycle
 * only ever *reads* that column now (`WorkflowStatusSyncRegistryService`
 * keeps it live), it never bypasses it.
 */
@Injectable()
export class SopService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly documentNumbering: DocumentNumberingService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListSopsQueryDto): Promise<PaginatedResult<Sop>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.SopWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { documentNumber: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.sop.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.sop.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  /** Active tenant users, id + display fields only (no roles, no email list dump). */
  async listAssignableReaders(
    actor: AuthenticatedUser,
  ): Promise<Array<{ id: string; fullName: string; email: string }>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.user.findMany({
        where: { companyId, status: 'active' },
        select: { id: true, fullName: true, email: true },
        orderBy: { fullName: 'asc' },
        take: 500,
      }),
    )
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Sop & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.sop.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })
      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE, recordId: id },
      })
      return { ...found, workflowInstanceId: workflowInstance?.id ?? null }
    })
  }

  async create(actor: AuthenticatedUser, dto: CreateSopDto, meta: RequestMeta): Promise<Sop> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      })
      const isTaken = async (candidate: string) =>
        (await tx.sop.count({
          where: { companyId, documentNumber: { equals: candidate, mode: 'insensitive' } },
        })) > 0
      const documentNumber =
        dto.documentNumber !== undefined && dto.documentNumber.trim() !== ''
          ? await this.documentNumbering.reserveManual(tx, companyId, dto.documentNumber, isTaken)
          : await this.documentNumbering.allocate(tx, {
              companyId,
              companyName: company?.name ?? '',
              documentType: dto.documentType,
              isTaken,
            })

      const created = await tx.sop.create({
        data: {
          id: newId(),
          companyId,
          documentNumber,
          title: dto.title,
          documentType: dto.documentType,
          productId: dto.productId ?? null,
          processArea: dto.processArea ?? null,
          currentVersion: 1,
          status: 'draft',
          nextPeriodicReviewDueAt: dto.nextPeriodicReviewDueAt
            ? new Date(dto.nextPeriodicReviewDueAt)
            : null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'sop_created',
        recordType: 'sop',
        recordId: created.id,
        newValue: {
          documentNumber: created.documentNumber,
          numberSource:
            dto.documentNumber && dto.documentNumber.trim() !== '' ? 'manual' : 'system',
          title: created.title,
          documentType: created.documentType,
        },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(
        actor,
        QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
        created.id,
        null,
        meta,
      )

      return created
    })
  }

  /**
   * The real "Revise" action from the flowchart's own Draft→Review&Approve→
   * Effective→Read&Understand→Revise/Retire lifecycle — deliberately NOT
   * a workflow transition on the existing document (an effective document
   * stays effective, and thus fully in force, until its replacement
   * itself goes effective — see `QualityWorkflowGuards`'s own supersede
   * logic). This opens a brand-new draft `Sop` row referencing
   * `supersedesDocumentId`, with its own fresh `WorkflowInstance`,
   * exactly like any other document — only reachable from an `effective`
   * document, never a draft/in-review one (revising something not yet
   * live has no real meaning).
   */
  async reviseNewVersion(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Sop> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const current = await tx.sop.findFirst({ where: { id, companyId } })
      if (!current)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })
      if (current.status !== 'effective') {
        throw new ConflictException({
          code: 'NOT_EFFECTIVE',
          message: 'Only an effective controlled document can be revised',
        })
      }

      const created = await tx.sop.create({
        data: {
          id: newId(),
          companyId,
          documentNumber: current.documentNumber,
          title: current.title,
          documentType: current.documentType,
          productId: current.productId,
          processArea: current.processArea,
          currentVersion: current.currentVersion + 1,
          status: 'draft',
          supersedesDocumentId: current.id,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'sop_revised',
        recordType: 'sop',
        recordId: created.id,
        oldValue: { supersedesDocumentId: current.id, previousVersion: current.currentVersion },
        newValue: {
          documentNumber: created.documentNumber,
          currentVersion: created.currentVersion,
        },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(
        actor,
        QUALITY_CONTROLLED_DOCUMENT_RECORD_TYPE,
        created.id,
        null,
        meta,
      )

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateSopDto,
    meta: RequestMeta,
  ): Promise<Sop> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.sop.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Controlled document not found' })
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_DRAFT',
          message: 'Only a draft controlled document can be edited this way',
        })
      }

      const updated = await tx.sop.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
          ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
          ...(dto.processArea !== undefined ? { processArea: dto.processArea } : {}),
          ...(dto.nextPeriodicReviewDueAt !== undefined
            ? { nextPeriodicReviewDueAt: new Date(dto.nextPeriodicReviewDueAt) }
            : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'sop_updated',
        recordType: 'sop',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }
}
