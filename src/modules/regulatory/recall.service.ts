import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Recall } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CreateRecallDto } from './dto/create-recall.dto'
import { ListRecallsQueryDto } from './dto/list-recalls-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface LinkedRecallCaseSummary {
  id: string
  referenceNumber: string
  status: string
}

export interface RecallTransitionLogEntry {
  fromStateKey: string | null
  toStateKey: string
  note: string | null
  actorName: string | null
  occurredAt: Date
}

export type RecallWithDetail = Recall & {
  product: { brandName: string }
  linkedCases: LinkedRecallCaseSummary[]
  workflowInstanceId: string | null
  transitionHistory: RecallTransitionLogEntry[]
}

/**
 * RegCloud (Phase 12) Stage 14 — the workflow's own record type. Must
 * always agree with `RECALL_WORKFLOW_RECORD_TYPE` in
 * `prisma/workflow.seed-data.ts` (both the literal string `"recall"`),
 * mirroring `REG_REGISTRATION_RECORD_TYPE`/`SIGNAL_RECORD_TYPE`'s own
 * precedent exactly.
 */
export const RECALL_RECORD_TYPE = 'recall'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A recall is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 14 — Post-Market & Recall. RegCloud's own
 * honest slice of a genuinely three-module event (per `todo-regcloud.md`'s
 * Reconciliation Note 5): the regulator-facing half lives here. Cross-
 * module integration to PV's own `Case` rows and QualCloud's own future
 * root-cause CAPA is built as plain FK/lookup links (`RecallCase`,
 * mirroring `SignalCase`'s exact shape; `Recall.rootCauseCapaId`),
 * deliberately never a shared workflow instance across modules that
 * don't otherwise share one. The lifecycle transitions themselves go
 * through the generic `POST /workflow/instances/:id/transition` endpoint,
 * exactly like `pv_case`/`signal`/`reg_registration` — see
 * `RecallWorkflowGuards` for the domain-specific gating on top of that.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRecallsQueryDto,
  ): Promise<PaginatedResult<Recall & { product: { brandName: string } }>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.recall.findMany({
          where,
          include: { product: { select: { brandName: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.recall.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RecallWithDetail> {
    const companyId = requireCompany(actor)
    const recall = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.recall.findFirst({
        where: { id, companyId },
        include: { product: { select: { brandName: true } } },
      })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const links = await tx.recallCase.findMany({
        where: { recallId: id },
        include: { case: { select: { id: true, referenceNumber: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      })

      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: RECALL_RECORD_TYPE, recordId: id },
        include: { currentState: true },
      })

      return {
        ...found,
        status: workflowInstance?.currentState.stateKey ?? found.status,
        linkedCases: links.map((l) => l.case),
        workflowInstanceId: workflowInstance?.id ?? null,
      }
    })

    const historyPage = await this.auditService.query(actor, {
      recordType: RECALL_RECORD_TYPE,
      recordId: id,
      action: 'state_change',
      page: 1,
      limit: 50,
    })
    const transitionHistory: RecallTransitionLogEntry[] = historyPage.data.map((entry) => {
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

    return { ...recall, transitionHistory }
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRecallDto,
    meta: RequestMeta,
  ): Promise<RecallWithDetail> {
    const companyId = requireCompany(actor)

    const createdId = await this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      if (dto.rootCauseCapaId) {
        const capa = await tx.capa.findFirst({ where: { id: dto.rootCauseCapaId, companyId } })
        if (!capa) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }

      const created = await tx.recall.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          reason: dto.reason,
          recallClass: dto.recallClass,
          rootCauseCapaId: dto.rootCauseCapaId,
          status: 'reported',
          initiatedBy: actor.sub,
          createdBy: actor.sub,
        },
      })

      if (dto.caseIds && dto.caseIds.length > 0) {
        await this.linkCasesInTx(tx, companyId, created.id, dto.caseIds)
      }

      // No natural country to resolve a country-specific workflow
      // variant against — a recall isn't authority-scoped the way a
      // dossier/promotional-material submission is, matching `Signal`'s
      // own `null`-countryId `instantiate()` precedent.
      await this.workflowService.instantiate(actor, RECALL_RECORD_TYPE, created.id, null, meta)

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_created',
        recordType: RECALL_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          productId: dto.productId,
          reason: dto.reason,
          recallClass: dto.recallClass ?? null,
          caseIds: dto.caseIds ?? [],
        },
        ip: meta.ip,
      })

      return created.id
    })

    return this.get(actor, createdId)
  }

  async linkCases(
    actor: AuthenticatedUser,
    id: string,
    caseIds: string[],
    meta: RequestMeta,
  ): Promise<RecallWithDetail> {
    const companyId = requireCompany(actor)

    await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recall.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const newlyLinked = await this.linkCasesInTx(tx, companyId, id, caseIds)
      if (newlyLinked > 0) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'recall_cases_linked',
          recordType: RECALL_RECORD_TYPE,
          recordId: id,
          newValue: { caseIds, newlyLinked },
          ip: meta.ip,
        })
      }
    })

    return this.get(actor, id)
  }

  private async linkCasesInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    recallId: string,
    caseIds: string[],
  ): Promise<number> {
    let newlyLinked = 0
    for (const caseId of caseIds) {
      const existing = await tx.recallCase.findUnique({
        where: { recallId_caseId: { recallId, caseId } },
      })
      if (existing) continue
      await tx.recallCase.create({ data: { id: newId(), companyId, recallId, caseId } })
      newlyLinked += 1
    }
    return newlyLinked
  }
}
