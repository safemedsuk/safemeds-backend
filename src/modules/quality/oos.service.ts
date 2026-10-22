import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Oos, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import {
  DirectUploadFile,
  DirectUploadResult,
  DocumentsService,
} from '../documents/documents.service'
import { CapaService } from '../internal-audit/capa.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CreateOosDto } from './dto/create-oos.dto'
import { ListOosQueryDto } from './dto/list-oos-query.dto'
import { OpenCapaForOosDto } from './dto/open-capa-for-oos.dto'
import { RecordOosFindingDto } from './dto/record-oos-finding.dto'
import { RecordOosPhase1Dto } from './dto/record-oos-phase1.dto'
import { RecordOosPhase2Dto } from './dto/record-oos-phase2.dto'
import { RecordOosRetestDto } from './dto/record-oos-retest.dto'

export interface RequestMeta {
  ip?: string
}

export const QUALITY_OOS_RECORD_TYPE = 'quality_oos'
/** Pass A2 (item 4b) — the `Document.recordType` an OOS finding's required test report / supporting documents are stored under. */
export const OOS_FINDING_RECORD_TYPE = 'oos_finding'
/** Pass A2 (item 4c) — the `Document.recordType` a manufacturing (Phase 2) investigation's required report is stored under. */
export const OOS_MANUFACTURING_REPORT_RECORD_TYPE = 'oos_manufacturing_report'

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
    private readonly documentsService: DocumentsService,
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

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Oos & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.oos.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })
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
      await this.assertFindingDocumentsIfText(tx, companyId, id, dto.findings)

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
          message:
            'Phase 2 findings can only be recorded once this investigation has entered Phase 2',
        })
      }

      await this.assertFindingDocumentsIfText(tx, companyId, id, dto.findings)

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

  /**
   * Pass A2 (item 4b) — a written finding can never be stored without at least
   * one attached finding document. Applies to the Phase 1/Phase 2 endpoints as
   * well as `recordFinding()`, so there is no route that records findings text
   * without the supporting document.
   */
  private async assertFindingDocumentsIfText(
    tx: Prisma.TransactionClient,
    companyId: string,
    oosId: string,
    findings: string | undefined,
  ): Promise<void> {
    if (!findings || findings.trim().length === 0) return
    const count = await tx.document.count({
      where: { companyId, recordType: OOS_FINDING_RECORD_TYPE, recordId: oosId },
    })
    if (count === 0) {
      throw new ConflictException({
        code: 'FINDING_DOCUMENT_REQUIRED',
        message:
          'Attach at least one document (for example the test report) before recording the finding',
      })
    }
  }

  /**
   * Pass A2 (item 4b) — "Record finding": the written finding for the
   * current investigation phase, which requires at least one attached
   * document (the test report or equivalent) before it can be recorded.
   */
  async recordFinding(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordOosFindingDto,
    meta: RequestMeta,
  ): Promise<Oos> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.oos.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed OOS investigation cannot take new findings',
        })
      }
      const documentCount = await tx.document.count({
        where: { companyId, recordType: OOS_FINDING_RECORD_TYPE, recordId: id },
      })
      if (documentCount === 0) {
        throw new ConflictException({
          code: 'FINDING_DOCUMENT_REQUIRED',
          message:
            'Attach at least one document (for example the test report) before recording the finding',
        })
      }

      const inPhase2 = existing.investigationPhase === 'phase_2_manufacturing_investigation'
      const updated = await tx.oos.update({
        where: { id },
        data: inPhase2 ? { phase2Findings: dto.findings } : { phase1Findings: dto.findings },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'oos_finding_recorded',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: id,
        newValue: { phase: existing.investigationPhase, supportingDocumentCount: documentCount },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Pass A2 (items 4b/4c) — attaches the finding's supporting document or the
   * manufacturing-investigation report. Server-proxied, then audited.
   */
  async uploadOosDocument(
    actor: AuthenticatedUser,
    id: string,
    kind: 'finding' | 'manufacturing_report',
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<DirectUploadResult> {
    const companyId = requireCompany(actor)
    const oos = await this.rls.runAsCompany(companyId, (tx) =>
      tx.oos.findFirst({ where: { id, companyId } }),
    )
    if (!oos)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })
    if (oos.status === 'closed') {
      throw new ConflictException({
        code: 'ALREADY_CLOSED',
        message: 'A closed OOS investigation cannot take new documents',
      })
    }

    const recordType =
      kind === 'manufacturing_report'
        ? OOS_MANUFACTURING_REPORT_RECORD_TYPE
        : OOS_FINDING_RECORD_TYPE
    const result = await this.documentsService.uploadDirect(
      actor,
      recordType,
      id,
      file,
      { title: file.originalname },
      meta,
    )

    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'oos_document_attached',
        recordType: QUALITY_OOS_RECORD_TYPE,
        recordId: id,
        newValue: { kind, documentId: result.document.id, filename: file.originalname },
        ip: meta.ip,
      }),
    )

    return result
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
      if (!oos)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'OOS investigation not found' })

      return this.capaService.createAllocatedFrom(tx, actor, companyId, 'oos', oosId, dto, meta)
    })
  }
}
