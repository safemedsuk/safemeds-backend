import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Deviation, Investigation, Prisma } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CapaService } from '../internal-audit/capa.service'
import { WorkflowService } from '../workflow/workflow.service'
import { CreateDeviationDto } from './dto/create-deviation.dto'
import { ListDeviationsQueryDto } from './dto/list-deviations-query.dto'
import { OpenCapaForDeviationDto } from './dto/open-capa-for-deviation.dto'
import { RecordInvestigationDto } from './dto/record-investigation.dto'

export interface RequestMeta {
  ip?: string
}

export const QUALITY_DEVIATION_RECORD_TYPE = 'quality_deviation'

/** 🧭 WHO-GMP-aligned default: 30 calendar days for Major/Critical, 10 for Minor, from detection. */
export const DEVIATION_INVESTIGATION_DUE_DAYS: Record<string, number> = {
  critical: 30,
  major: 30,
  minor: 10,
}

type DecryptedDeviation = Omit<Deviation, 'descriptionEncrypted'> & { description: string | null }

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Deviations are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

async function nextDeviationNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear()
  const count = await tx.deviation.count({
    where: { companyId, deviationNumber: { startsWith: `DEV-${year}-` } },
  })
  return `DEV-${year}-${String(count + 1).padStart(5, '0')}`
}

/**
 * QualCloud (Phase 13) Stage 2 — Deviation & Non-Conformance Management.
 * Master quality-event lifecycle stages 1–3 (Detect/Raise → Assess &
 * Classify → Investigate/Root Cause). `classify()` fires through the
 * *generic* `WorkflowService.transition()` (`toStateKey: 'classifying'`,
 * `payload: { severity }`) rather than a bespoke endpoint —
 * `QualityWorkflowGuards`' own status-sync function reads
 * `ctx.payload.severity` and does the real domain writes (severity,
 * `investigationDueAt`, the critical-escalation notification) inside
 * that same transition transaction, mirroring `RegWorkflowGuards`'
 * own established "payload-driven domain write inside the sync
 * function" precedent exactly.
 */
@Injectable()
export class DeviationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly textEncryption: TextEncryptionService,
    private readonly capaService: CapaService,
  ) {}

  private decrypt(row: Deviation): DecryptedDeviation {
    const { descriptionEncrypted, ...rest } = row
    return {
      ...rest,
      description: descriptionEncrypted ? this.textEncryption.decrypt(descriptionEncrypted) : null,
    }
  }

  async list(
    actor: AuthenticatedUser,
    query: ListDeviationsQueryDto,
  ): Promise<PaginatedResult<DecryptedDeviation>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.DeviationWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { deviationNumber: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.deviation.findMany({
          where,
          orderBy: { detectedAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.deviation.count({ where }),
      ])
      return paginate(
        rows.map((r) => this.decrypt(r)),
        total,
        query,
      )
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<
    DecryptedDeviation & { investigation: Investigation | null; workflowInstanceId: string | null }
  > {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.deviation.findFirst({
        where: { id, companyId },
        include: { investigation: true },
      })
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deviation not found' })
      const { investigation, ...rest } = found
      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: QUALITY_DEVIATION_RECORD_TYPE, recordId: id },
      })
      return {
        ...this.decrypt(rest),
        investigation,
        workflowInstanceId: workflowInstance?.id ?? null,
      }
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateDeviationDto,
    meta: RequestMeta,
  ): Promise<DecryptedDeviation> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const deviationNumber = await nextDeviationNumber(tx, companyId)

      const created = await tx.deviation.create({
        data: {
          id: newId(),
          companyId,
          deviationNumber,
          title: dto.title,
          descriptionEncrypted: dto.description
            ? this.textEncryption.encrypt(dto.description)
            : null,
          sourceType: dto.sourceType,
          productId: dto.productId ?? null,
          batchId: dto.batchId ?? null,
          equipmentId: dto.equipmentId ?? null,
          supplierId: dto.supplierId ?? null,
          sopId: dto.sopId ?? null,
          detectedAt: new Date(dto.detectedAt),
          raisedBy: actor.sub,
          containmentActions: dto.containmentActions ?? null,
          status: 'detected',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'deviation_created',
        recordType: QUALITY_DEVIATION_RECORD_TYPE,
        recordId: created.id,
        newValue: { deviationNumber: created.deviationNumber, title: created.title },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(
        actor,
        QUALITY_DEVIATION_RECORD_TYPE,
        created.id,
        null,
        meta,
      )

      return this.decrypt(created)
    })
  }

  /**
   * Records (or updates) the investigation record while `investigating`
   * — a plain CRUD write alongside the workflow, not a transition
   * itself, matching `CausalityService`'s own established shape for
   * PV cases (assess repeatedly, transition separately once complete).
   */
  async recordInvestigation(
    actor: AuthenticatedUser,
    deviationId: string,
    dto: RecordInvestigationDto,
    meta: RequestMeta,
  ): Promise<Investigation> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const deviation = await tx.deviation.findFirst({ where: { id: deviationId, companyId } })
      if (!deviation)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deviation not found' })

      const existing = await tx.investigation.findUnique({ where: { deviationId } })
      const saved = existing
        ? await tx.investigation.update({
            where: { id: existing.id },
            data: {
              ...(dto.rootCauseMethod !== undefined
                ? { rootCauseMethod: dto.rootCauseMethod }
                : {}),
              ...(dto.findings !== undefined ? { findings: dto.findings } : {}),
              ...(dto.evidenceReferences !== undefined
                ? { evidenceReferences: dto.evidenceReferences }
                : {}),
              ...(dto.investigatorUserId !== undefined
                ? { investigatorUserId: dto.investigatorUserId }
                : {}),
              ...(dto.reviewerUserId !== undefined ? { reviewerUserId: dto.reviewerUserId } : {}),
            },
          })
        : await tx.investigation.create({
            data: {
              id: newId(),
              companyId,
              deviationId,
              rootCauseMethod: dto.rootCauseMethod ?? null,
              findings: dto.findings ?? null,
              evidenceReferences: dto.evidenceReferences ?? null,
              investigatorUserId: dto.investigatorUserId ?? actor.sub,
              reviewerUserId: dto.reviewerUserId ?? null,
            },
          })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: existing ? 'investigation_updated' : 'investigation_recorded',
        recordType: QUALITY_DEVIATION_RECORD_TYPE,
        recordId: deviationId,
        newValue: { rootCauseMethod: saved.rootCauseMethod },
        ip: meta.ip,
      })

      return saved
    })
  }

  /**
   * Opens the CAPA `QualityWorkflowGuards`' own `capa_pending → closed`
   * guard requires — only while the deviation is in `capa_pending`,
   * using `CapaService.createFrom()`'s direct, non-HTTP entry point
   * inside this same transaction, exactly as that method's own doc
   * comment anticipates.
   */
  async openCapaForDeviation(
    actor: AuthenticatedUser,
    deviationId: string,
    dto: OpenCapaForDeviationDto,
    meta: RequestMeta,
  ) {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const deviation = await tx.deviation.findFirst({ where: { id: deviationId, companyId } })
      if (!deviation)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deviation not found' })
      if (deviation.status !== 'capa_pending') {
        throw new ConflictException({
          code: 'NOT_CAPA_PENDING',
          message: 'A CAPA can only be opened once this deviation has reached CAPA Pending',
        })
      }

      const capa = await this.capaService.createFrom(
        tx,
        actor,
        companyId,
        'deviation',
        deviationId,
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

      return capa
    })
  }
}
