import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Oos, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CapaService } from '../internal-audit/capa.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CreateOosDto } from './dto/create-oos.dto'
import { ListOosQueryDto } from './dto/list-oos-query.dto'
import { OpenCapaForOosDto } from './dto/open-capa-for-oos.dto'
import { RecordOosPhase1Dto } from './dto/record-oos-phase1.dto'
import { RecordOosPhase2Dto } from './dto/record-oos-phase2.dto'
import { RecordOosRetestDto } from './dto/record-oos-retest.dto'

export interface RequestMeta {
  ip?: string
}

export const QUALITY_OOS_RECORD_TYPE = 'quality_oos'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'OOS/OOT investigations are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

async function nextOosNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
  const count = await tx.oos.count({
    where: { companyId, oosNumber: { startsWith: `OOS-${year}-` } },
  })
  return `OOS-${year}-${String(count + 1).padStart(5, '0')}`
}

/**
 * QualCloud (Phase 13) Stage 6 — Out-of-Specification (OOS)/
 * Out-of-Trend (OOT) Investigation. The real two-phase FDA/*Barr Labs*
 * model, made structural — `recordPhase1()`/`recordRetest()`/
 * `recordPhase2()` are plain data writes; the actual
 * `phase_1_lab_investigation → closed` transition is what
 * `QualityWorkflowGuards` blocks unless `phase1AssignableCauseFound`
 * is true, and `→ phase_2_manufacturing_investigation` is what its own
 * status-sync stamps `phase2Triggered: true` on.
 */
@Injectable()
export class OosService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly capaService: CapaService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListOosQueryDto): Promise<PaginatedResult<Oos>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.OosWhereInput = {
        companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.oos.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.oos.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Oos & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.oos.findFirst({ where: { id, companyId } })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })
      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: QUALITY_OOS_RECORD_TYPE, recordId: id },
      })
      return { ...found, workflowInstanceId: workflowInstance?.id ?? null }
    })
  }

  async create(actor: AuthenticatedUser, dto: CreateOosDto, meta: RequestMeta): Promise<Oos> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const oosNumber = await nextOosNumber(tx, companyId)

      const created = await tx.oos.create({
        data: {
          id: newId(),
          companyId,
          oosNumber,
          batchId: dto.batchId,
          specificationId: dto.specificationId,
          parameterId: dto.parameterId,
          testResult: dto.testResult,
          investigationPhase: 'phase_1_lab_investigation',
          status: 'phase_1_lab_investigation',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'oos_created',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: created.id,
        newValue: { oosNumber: created.oosNumber, testResult: created.testResult },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(actor, QUALITY_OOS_RECORD_TYPE, created.id, null, meta)

      return created
    })
  }

  async recordPhase1(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordOosPhase1Dto,
    meta: RequestMeta,
  ): Promise<Oos> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.oos.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })

      const updated = await tx.oos.update({
        where: { id },
        data: {
          phase1AssignableCauseFound: dto.assignableCauseFound,
          phase1Findings: dto.findings ?? null,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'oos_phase1_recorded',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: id,
        newValue: { assignableCauseFound: dto.assignableCauseFound },
        ip: meta.ip,
      })

      return updated
    })
  }

  async recordRetest(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordOosRetestDto,
    meta: RequestMeta,
  ): Promise<Oos> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.oos.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })

      const updated = await tx.oos.update({
        where: { id },
        data: { retestAuthorized: dto.authorized, retestRationale: dto.rationale },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'oos_retest_recorded',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: id,
        newValue: { authorized: dto.authorized, rationale: dto.rationale },
        ip: meta.ip,
      })

      return updated
    })
  }

  async recordPhase2(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordOosPhase2Dto,
    meta: RequestMeta,
  ): Promise<Oos> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.oos.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })
      if (existing.investigationPhase !== 'phase_2_manufacturing_investigation') {
        throw new ConflictException({
          code: 'NOT_IN_PHASE_2',
          message: 'Phase 2 findings can only be recorded once this investigation has entered Phase 2',
        })
      }

      const updated = await tx.oos.update({
        where: { id },
        data: {
          phase2Findings: dto.findings ?? null,
          ...(dto.batchImpact ? { batchImpact: dto.batchImpact } : {}),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'oos_phase2_recorded',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: id,
        newValue: { batchImpact: dto.batchImpact },
        ip: meta.ip,
      })

      if (dto.batchImpact === 'batch_rejected' || dto.batchImpact === 'batch_reworked') {
        await tx.batch.update({
          where: { id: existing.batchId },
          data: { qualityStatus: dto.batchImpact === 'batch_rejected' ? 'rejected' : 'reworked' },
        })
      }

      return updated
    })
  }

  async openCapaForOos(
    actor: AuthenticatedUser,
    oosId: string,
    dto: OpenCapaForOosDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const oos = await tx.oos.findFirst({ where: { id: oosId, companyId } })
      if (!oos) throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })

      return this.capaService.createFrom(
        tx,
        actor,
        companyId,
        'oos',
        oosId,
        {
          title: dto.title,
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction,
          rootCauseCategory: dto.rootCauseCategory,
          ownerUserId: dto.ownerUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
        meta,
      )
    })
  }
}
