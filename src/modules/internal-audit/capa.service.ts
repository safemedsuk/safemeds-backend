import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Capa, CapaStatus, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { TasksService } from '../tasks/tasks.service'
import { ApproveCapaDto } from './dto/approve-capa.dto'
import { AssignCapaActionDto } from './dto/assign-capa-action.dto'
import { CreateCapaDto } from './dto/create-capa.dto'
import { ListCapasQueryDto } from './dto/list-capas-query.dto'
import { RecordCapaEffectivenessDto } from './dto/record-capa-effectiveness.dto'
import { UpdateCapaDto } from './dto/update-capa.dto'

/** 🧭 Admin-editable in spirit (a coded default for now, same discipline as every other Stage 0 default) — a new quality event linking back to a CAPA closed `effective` within this window, sharing the same root-cause category, is flagged as a possible recurring issue. */
const RECURRING_LOOKBACK_MONTHS = 12

export interface RequestMeta {
  ip?: string
}

export const CAPA_RECORD_TYPE = 'capa'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'CAPAs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 16.3 — "a CAPA isn't closeable until its effectiveness
 * is separately confirmed, not just marked done" (this stage's own
 * build-spec text). `recordEffectivenessCheck()` and `close()` are two
 * deliberately separate steps — the same two-step shape
 * `ExpectednessService`/`CodingService` already established for
 * "assess, then the assessment becomes usable elsewhere" — reusing the
 * existing `quality.close_capa` permission (seeded since Phase 2, never
 * wired to a real endpoint until now) for both, since both are the
 * "closing" side of the workflow `quality.log_deviation`/
 * `quality.manage_capa` (opening/logging) don't cover.
 */
@Injectable()
export class CapaService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateCapaDto, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)

    // `findingId` alone still resolves to `sourceRecordType: 'audit_finding'`
    // unchanged — matching how every existing row was backfilled in the
    // migration that introduced the polymorphic pair (Reconciliation
    // Note 4) — unless a caller explicitly names a different source
    // (never expected in practice, since `findingId` and a non-`audit_finding`
    // `sourceRecordType` together would be a contradiction, but the
    // explicit value always wins if both are somehow given).
    const sourceRecordType = dto.sourceRecordType ?? (dto.findingId ? 'audit_finding' : null)
    const sourceRecordId = dto.sourceRecordId ?? (dto.findingId ? dto.findingId : null)

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.findingId) {
        const finding = await tx.auditFinding.findFirst({ where: { id: dto.findingId, companyId } })
        if (!finding) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audit finding not found' })
        }
      }

      const created = await tx.capa.create({
        data: {
          id: newId(),
          companyId,
          findingId: dto.findingId ?? null,
          sourceRecordType,
          sourceRecordId,
          title: dto.title,
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction ?? null,
          rootCauseCategory: dto.rootCauseCategory ?? null,
          ownerUserId: dto.ownerUserId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      })

      if (dto.findingId) {
        await tx.auditFinding.update({
          where: { id: dto.findingId },
          data: { status: 'capa_assigned' },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_opened',
        recordType: CAPA_RECORD_TYPE,
        recordId: created.id,
        newValue: {
          title: created.title,
          findingId: created.findingId,
          sourceRecordType: created.sourceRecordType,
          sourceRecordId: created.sourceRecordId,
        },
        ip: meta.ip,
      })

      if (dto.rootCauseCategory) {
        await this.flagRecurrenceIfAny(
          tx,
          companyId,
          dto.rootCauseCategory,
          created.id,
          sourceRecordType,
          sourceRecordId,
          meta,
        )
      }

      return created
    })
  }

  /**
   * QualCloud (Phase 13) Stage 3 — "if a new Deviation/Complaint/Oos
   * links back to a Capa that was closed as 'effective' within the last
   * 12 months and shares the same root-cause category, the CAPA is
   * flagged (not auto-reopened — a human decides) as a recurring
   * issue" (`todo-qualcloud.md` Stage 3's own wording). Runs every time
   * a new CAPA is opened with a `rootCauseCategory` — generic across
   * every source type by design, so any future quality-event module
   * gets this check for free the moment it starts passing the field.
   */
  private async flagRecurrenceIfAny(
    tx: Prisma.TransactionClient,
    companyId: string,
    rootCauseCategory: string,
    newCapaId: string,
    newSourceRecordType: string | null,
    newSourceRecordId: string | null,
    meta: RequestMeta,
  ): Promise<void> {
    const lookbackFrom = new Date()
    lookbackFrom.setUTCMonth(lookbackFrom.getUTCMonth() - RECURRING_LOOKBACK_MONTHS)

    const priorEffective = await tx.capa.findFirst({
      where: {
        companyId,
        id: { not: newCapaId },
        rootCauseCategory,
        status: 'closed',
        effectivenessCheckResult: 'effective',
        closedAt: { gte: lookbackFrom },
      },
      orderBy: { closedAt: 'desc' },
    })
    if (!priorEffective || priorEffective.flaggedRecurring) return

    await tx.capa.update({
      where: { id: priorEffective.id },
      data: {
        flaggedRecurring: true,
        recurringFlagReason: `A new CAPA (${newSourceRecordType ?? 'unknown source'}/${newSourceRecordId ?? newCapaId}) sharing root-cause category "${rootCauseCategory}" was opened within ${RECURRING_LOOKBACK_MONTHS} months of this CAPA's own effective closure.`,
      },
    })

    await this.auditService.log(tx, {
      companyId,
      actorType: 'system',
      action: 'capa_flagged_recurring',
      recordType: CAPA_RECORD_TYPE,
      recordId: priorEffective.id,
      newValue: { rootCauseCategory, triggeredByCapaId: newCapaId },
      ip: meta.ip,
    })
  }

  /**
   * QualCloud (Phase 13) Stage 0.3 — the direct, non-HTTP entry point a
   * future quality-event service (deviation, OOS/OOT, complaint, change
   * control, recall investigation, PQR action, supplier-audit finding)
   * calls to open a CAPA against itself, inside its own already-open
   * `runAsCompany` transaction (`tx`), rather than going through
   * `create()`'s own DTO validation and separate transaction. Kept on
   * this same service (not duplicated) so every CAPA — regardless of
   * source — is created, audited, and later closed through exactly one
   * code path, per this stage's own single-unified-screen design goal.
   */
  async createFrom(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    companyId: string,
    sourceRecordType: string,
    sourceRecordId: string,
    input: {
      title: string
      correctiveAction: string
      preventiveAction?: string
      rootCauseCategory?: string
      ownerUserId?: string
      dueDate?: Date
    },
    meta: RequestMeta,
  ): Promise<Capa> {
    const created = await tx.capa.create({
      data: {
        id: newId(),
        companyId,
        sourceRecordType,
        sourceRecordId,
        title: input.title,
        correctiveAction: input.correctiveAction,
        preventiveAction: input.preventiveAction ?? null,
        rootCauseCategory: input.rootCauseCategory ?? null,
        ownerUserId: input.ownerUserId ?? null,
        dueDate: input.dueDate ?? null,
      },
    })

    await this.auditService.log(tx, {
      companyId,
      actorUserId: actor.sub,
      action: 'capa_opened',
      recordType: CAPA_RECORD_TYPE,
      recordId: created.id,
      newValue: { title: created.title, sourceRecordType, sourceRecordId },
      ip: meta.ip,
    })

    if (input.rootCauseCategory) {
      await this.flagRecurrenceIfAny(
        tx,
        companyId,
        input.rootCauseCategory,
        created.id,
        sourceRecordType,
        sourceRecordId,
        meta,
      )
    }

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCapaDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot be edited',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction,
          ownerUserId: dto.ownerUserId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: dto.status,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_updated',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        oldValue: { status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Refines the three distinct correction/corrective/preventive-action fields — see `AssignCapaActionDto`'s own doc comment. */
  async assignAction(
    actor: AuthenticatedUser,
    id: string,
    dto: AssignCapaActionDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot be edited',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          ...(dto.correction !== undefined ? { correction: dto.correction } : {}),
          ...(dto.correctiveAction !== undefined ? { correctiveAction: dto.correctiveAction } : {}),
          ...(dto.preventiveAction !== undefined ? { preventiveAction: dto.preventiveAction } : {}),
          ...(dto.rootCauseCategory !== undefined
            ? { rootCauseCategory: dto.rootCauseCategory }
            : {}),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_action_assigned',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      if (dto.rootCauseCategory) {
        await this.flagRecurrenceIfAny(
          tx,
          companyId,
          dto.rootCauseCategory,
          id,
          updated.sourceRecordType,
          updated.sourceRecordId,
          meta,
        )
      }

      return updated
    })
  }

  /**
   * The cross-functional sign-off before implementation begins — "QA
   * plus, where the action touches a regulated filing, a Reg-side
   * approver too" (`todo-qualcloud.md` Stage 3's own wording, the
   * Build Priority doc's named cross-module join). `requiresRegulatoryApproval`
   * is set explicitly here, never inferred; `close()` enforces it.
   */
  async approve(
    actor: AuthenticatedUser,
    id: string,
    dto: ApproveCapaDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot be edited',
        })
      }
      if (existing.approvedAt) {
        throw new ConflictException({
          code: 'ALREADY_APPROVED',
          message: 'This CAPA is already approved',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          approvedBy: actor.sub,
          approvedAt: new Date(),
          requiresRegulatoryApproval: dto.requiresRegulatoryApproval ?? false,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_approved',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { requiresRegulatoryApproval: updated.requiresRegulatoryApproval },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** The regulatory-side approval `approve()` flagged as required — a distinct actor from the QA approver by construction (a different permission gate on the controller). */
  async regulatoryApprove(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      if (!existing.requiresRegulatoryApproval) {
        throw new ConflictException({
          code: 'REGULATORY_APPROVAL_NOT_REQUIRED',
          message: 'This CAPA was not marked as needing regulatory approval',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: { regulatoryApprovedBy: actor.sub, regulatoryApprovedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_regulatory_approved',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Marks implementation as under way — requires `approve()` to have run first. */
  async implement(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot be edited',
        })
      }
      if (!existing.approvedAt) {
        throw new ConflictException({
          code: 'APPROVAL_REQUIRED',
          message: 'This CAPA must be approved before implementation can begin',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: { status: 'in_progress', implementedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_implemented',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        ip: meta.ip,
      })

      return updated
    })
  }

  /** The mandatory separate step before `close()` will ever accept this CAPA. */
  async recordEffectivenessCheck(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordCapaEffectivenessDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot have a new effectiveness check recorded',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          status: 'pending_effectiveness_check',
          effectivenessCheckedAt: new Date(),
          effectivenessCheckedBy: actor.sub,
          effectivenessCheckResult: dto.result,
          effectivenessCheckNote: dto.note ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_effectiveness_checked',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { result: dto.result },
        ip: meta.ip,
      })

      return updated
    })
  }

  async close(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.capa.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'This CAPA is already closed',
        })
      }
      if (!existing.effectivenessCheckResult) {
        throw new ConflictException({
          code: 'EFFECTIVENESS_CHECK_REQUIRED',
          message: 'Record an effectiveness check before this CAPA can be closed',
        })
      }
      if (existing.requiresRegulatoryApproval && !existing.regulatoryApprovedAt) {
        throw new ConflictException({
          code: 'REGULATORY_APPROVAL_REQUIRED',
          message: 'This CAPA was marked as needing regulatory approval — obtain it before closing',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: { status: 'closed', closedAt: new Date() },
      })

      if (existing.findingId) {
        await tx.auditFinding.update({
          where: { id: existing.findingId },
          data: { status: 'closed' },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_closed',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { effectivenessCheckResult: existing.effectivenessCheckResult },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser, query: ListCapasQueryDto): Promise<PaginatedResult<Capa>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.CapaWhereInput = {
        companyId,
        ...(query.sourceRecordType ? { sourceRecordType: query.sourceRecordType } : {}),
        ...(query.status ? { status: query.status as CapaStatus } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.capa.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.capa.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Capa> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.capa.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
      }
      return found
    })
  }

  /**
   * The daily overdue-CAPA scan — reuses `TasksService.escalateForRecord()`
   * + a daily processor, mirroring every other overdue-scan job in this
   * codebase (RegCloud's fee/obligation/licensing scans) rather than
   * inventing a new job shape. Every company with at least one overdue,
   * non-closed CAPA gets scanned; called from `CapaOverdueProcessor`.
   */
  async escalateOverdue(): Promise<{ companiesScanned: number; capasEscalated: number }> {
    const now = new Date()
    const overdue = await this.rls.runWithSystemAccess((tx) =>
      tx.capa.findMany({
        where: { status: { not: 'closed' }, dueDate: { lt: now } },
        select: { id: true, companyId: true, title: true, dueDate: true },
      }),
    )

    const companies = new Set<string>()
    for (const capa of overdue) {
      companies.add(capa.companyId)
      await this.tasksService.escalateForRecord(
        capa.companyId,
        CAPA_RECORD_TYPE,
        capa.id,
        'overdue',
        `CAPA overdue: ${capa.title}`,
        {},
      )
    }

    return { companiesScanned: companies.size, capasEscalated: overdue.length }
  }
}
