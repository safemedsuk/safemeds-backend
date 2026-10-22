import {
  BadRequestException,
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
import {
  DirectUploadFile,
  DirectUploadResult,
  DocumentsService,
} from '../documents/documents.service'
import { RolesService } from '../roles/roles.service'
import { TasksService } from '../tasks/tasks.service'
import {
  assertUserHoldsPermission,
  CAPA_CLOSE_PERMISSION,
  CAPA_MANAGE_PERMISSION,
  forbidCapaAction,
  isCapaManagerTier,
  isCapaParticipant,
  listUsersHoldingPermission,
  normalizeAllocation,
  NormalizedAllocation,
  REGULATORY_APPROVER_PERMISSION,
  resolveRootCauseCategory,
} from './capa-allocation'
import { ApproveCapaDto } from './dto/approve-capa.dto'
import { AssignCapaActionDto } from './dto/assign-capa-action.dto'
import { CapaAllocationDto } from './dto/capa-allocation.dto'
import { CreateCapaDto } from './dto/create-capa.dto'
import { ListCapasQueryDto } from './dto/list-capas-query.dto'
import { ReassignCapaRegulatoryApproverDto } from './dto/reassign-capa-regulatory-approver.dto'
import { RecordCapaEffectivenessDto } from './dto/record-capa-effectiveness.dto'
import { UpdateCapaDto } from './dto/update-capa.dto'

/** 🧭 Admin-editable in spirit (a coded default for now, same discipline as every other Stage 0 default) — a new quality event linking back to a CAPA closed `effective` within this window, sharing the same root-cause category, is flagged as a possible recurring issue. */
const RECURRING_LOOKBACK_MONTHS = 12

export interface RequestMeta {
  ip?: string
}

export const CAPA_RECORD_TYPE = 'capa'
/** The `Document.recordType` a CAPA's closing evidence is attached under. */
export const CAPA_EVIDENCE_RECORD_TYPE = 'capa'

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
 * CAPA visibility and action rule (QualCloud Phase 1 Pass A2, item 3d).
 *
 * - **Managers** — any user holding `quality.view_all` or `quality.manage_capa`
 *   — see every CAPA and act on it with the permission they hold. This is
 *   unchanged from before Pass A2, so no existing manager loses access.
 * - **Everyone else** sees, and can act on, only a CAPA they are a named
 *   participant on: its current owner (`ownerUserId`), its creator
 *   (`createdBy`), or its designated regulatory approver
 *   (`regulatoryApproverUserId`, for the regulatory-approval step).
 * - Acting still requires the action's own permission (e.g. `close_capa` to
 *   close). Reassigning an owner or regulatory approver is open to the
 *   creator, the current owner, or a manager.
 * - Visibility misses return 404 (the CAPA's existence is not revealed);
 *   action misses return 403 `CAPA_NOT_ASSIGNED`.
 *
 * Note: `quality.view_all` is held by the QUALITY_ASSOCIATE role as well as
 * QUALITY_MANAGER, so under this rule associates keep company-wide CAPA
 * visibility. Narrowing that is a one-line change to `isCapaManagerTier`.
 *
 * The `quality.close_capa` effectiveness check and close steps, the
 * cross-functional approve step, and the regulatory approval step each stay
 * single, separately-audited actions.
 */
@Injectable()
export class CapaService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly rolesService: RolesService,
    private readonly documentsService: DocumentsService,
  ) {}

  private permissionsFor(actor: AuthenticatedUser): Promise<Set<string>> {
    return this.rolesService.getPermissionsForUser(actor)
  }

  /** Visibility check for a loaded CAPA; throws 404 when the actor may not see it at all. */
  private assertVisible(actor: AuthenticatedUser, permissions: Set<string>, capa: Capa): void {
    if (isCapaManagerTier(permissions)) return
    if (isCapaParticipant(actor.sub, capa)) return
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
  }

  /** Action check: the actor must be a manager or a named participant. The action's own permission is checked by the caller. */
  private assertActable(actor: AuthenticatedUser, permissions: Set<string>, capa: Capa): void {
    if (isCapaManagerTier(permissions)) return
    if (isCapaParticipant(actor.sub, capa)) return
    throw forbidCapaAction()
  }

  private assertCanReassign(actor: AuthenticatedUser, permissions: Set<string>, capa: Capa): void {
    if (!permissions.has(CAPA_MANAGE_PERMISSION)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to reassign CAPAs',
      })
    }
    if (isCapaManagerTier(permissions)) return
    if (capa.createdBy === actor.sub || capa.ownerUserId === actor.sub) return
    throw forbidCapaAction(
      'Only the CAPA creator, its current owner, or a quality manager can reassign it',
    )
  }

  private async loadCapa(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<Capa> {
    const found = await tx.capa.findFirst({ where: { id, companyId } })
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'CAPA not found' })
    return found
  }

  private assertNotClosed(capa: Capa): void {
    if (capa.status === 'closed') {
      throw new ConflictException({
        code: 'ALREADY_CLOSED',
        message: 'A closed CAPA cannot be edited',
      })
    }
  }

  // ── Allocation rules: shared by every opener ─────────────────────────

  /** The one CAPA-creation path that enforces the full Pass A2 allocation rule. Called inside the caller's own transaction. */
  private async insertAllocated(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    companyId: string,
    allocation: NormalizedAllocation,
    source: {
      sourceRecordType: string | null
      sourceRecordId: string | null
      findingId: string | null
    },
    meta: RequestMeta,
  ): Promise<Capa> {
    await assertUserHoldsPermission(
      tx,
      companyId,
      allocation.ownerUserId,
      CAPA_MANAGE_PERMISSION,
      'OWNER_NOT_QUALIFIED',
      'The CAPA owner must be an active user who holds the quality.manage_capa permission',
    )
    if (allocation.regulatoryApproverUserId) {
      await assertUserHoldsPermission(
        tx,
        companyId,
        allocation.regulatoryApproverUserId,
        REGULATORY_APPROVER_PERMISSION,
        'REGULATORY_APPROVER_NOT_QUALIFIED',
        'The regulatory approver must be an active user who holds the regulatory.manage_registrations permission',
      )
    }

    const created = await tx.capa.create({
      data: {
        id: newId(),
        companyId,
        findingId: source.findingId,
        sourceRecordType: source.sourceRecordType,
        sourceRecordId: source.sourceRecordId,
        title: allocation.title,
        rootCause: allocation.rootCause,
        rootCauseCategory: allocation.rootCauseCategory,
        correctiveAction: allocation.correctiveAction,
        preventiveAction: allocation.preventiveAction,
        ownerUserId: allocation.ownerUserId,
        correctiveActionDueDate: allocation.correctiveActionDueDate,
        preventiveActionDueDate: allocation.preventiveActionDueDate,
        dueDate: allocation.dueDate,
        requiresRegulatoryApproval: allocation.requiresRegulatoryApproval,
        regulatoryApproverUserId: allocation.regulatoryApproverUserId,
        createdBy: actor.sub,
      },
    })

    await this.auditService.log(tx, {
      companyId,
      actorUserId: actor.sub,
      action: 'capa_opened',
      recordType: CAPA_RECORD_TYPE,
      recordId: created.id,
      newValue: {
        title: created.title,
        rootCause: created.rootCause,
        rootCauseCategory: created.rootCauseCategory,
        ownerUserId: created.ownerUserId,
        correctiveActionDueDate: created.correctiveActionDueDate,
        preventiveActionDueDate: created.preventiveActionDueDate,
        requiresRegulatoryApproval: created.requiresRegulatoryApproval,
        regulatoryApproverUserId: created.regulatoryApproverUserId,
        findingId: created.findingId,
        sourceRecordType: created.sourceRecordType,
        sourceRecordId: created.sourceRecordId,
      },
      ip: meta.ip,
    })

    if (created.regulatoryApproverUserId) {
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_regulatory_approver_assigned',
        recordType: CAPA_RECORD_TYPE,
        recordId: created.id,
        newValue: { regulatoryApproverUserId: created.regulatoryApproverUserId },
        ip: meta.ip,
      })
    }

    await this.flagRecurrenceIfAny(
      tx,
      companyId,
      created.rootCauseCategory ?? '',
      created.id,
      source.sourceRecordType,
      source.sourceRecordId,
      meta,
    )

    return created
  }

  async create(actor: AuthenticatedUser, dto: CreateCapaDto, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)
    const allocation = normalizeAllocation(dto)

    // `findingId` alone still resolves to `sourceRecordType: 'audit_finding'`
    // unchanged (Reconciliation Note 4). An explicit source always wins.
    const sourceRecordType = dto.sourceRecordType ?? (dto.findingId ? 'audit_finding' : null)
    const sourceRecordId = dto.sourceRecordId ?? (dto.findingId ? dto.findingId : null)

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.findingId) {
        const finding = await tx.auditFinding.findFirst({ where: { id: dto.findingId, companyId } })
        if (!finding) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audit finding not found' })
        }
      }

      const created = await this.insertAllocated(
        tx,
        actor,
        companyId,
        allocation,
        { sourceRecordType, sourceRecordId, findingId: dto.findingId ?? null },
        meta,
      )

      if (dto.findingId) {
        await tx.auditFinding.update({
          where: { id: dto.findingId },
          data: { status: 'capa_assigned' },
        })
      }

      return created
    })
  }

  /**
   * The entry point for user-facing openers (Deviation, OOS/OOT, Complaint)
   * that run inside their own already-open transaction. Enforces the full
   * Pass A2 allocation rule via the same `insertAllocated()` path `create()` uses.
   */
  async createAllocatedFrom(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    companyId: string,
    sourceRecordType: string,
    sourceRecordId: string,
    dto: CapaAllocationDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const allocation = normalizeAllocation(dto)
    return this.insertAllocated(
      tx,
      actor,
      companyId,
      allocation,
      { sourceRecordType, sourceRecordId, findingId: null },
      meta,
    )
  }

  /**
   * QualCloud (Phase 13) Stage 3 — "if a new Deviation/Complaint/Oos
   * links back to a Capa that was closed as 'effective' within the last
   * 12 months and shares the same root-cause category, the CAPA is
   * flagged (not auto-reopened — a human decides) as a recurring
   * issue". Generic across every source type by design.
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
    if (!rootCauseCategory) return
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
   * Legacy direct entry point for system-originated CAPAs (recall
   * investigations, PQR actions, management-review actions) that have no
   * human owner to allocate at creation time. Those callers are the one
   * remaining gap in the owner rule; they are tracked for a follow-up, not
   * silently treated as allocated. User-facing openers use
   * `createAllocatedFrom()` instead.
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
        rootCause: input.title,
        correctiveAction: input.correctiveAction,
        preventiveAction: input.preventiveAction ?? null,
        rootCauseCategory: input.rootCauseCategory ?? null,
        ownerUserId: input.ownerUserId ?? null,
        dueDate: input.dueDate ?? null,
        correctiveActionDueDate: input.dueDate ?? null,
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
    const permissions = await this.permissionsFor(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertNotClosed(existing)
      this.assertVisible(actor, permissions, existing)
      if (!permissions.has(CAPA_MANAGE_PERMISSION)) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to edit CAPAs',
        })
      }
      this.assertActable(actor, permissions, existing)

      const ownerChanging =
        dto.ownerUserId !== undefined && dto.ownerUserId !== existing.ownerUserId
      if (ownerChanging) {
        this.assertCanReassign(actor, permissions, existing)
        await assertUserHoldsPermission(
          tx,
          companyId,
          dto.ownerUserId!,
          CAPA_MANAGE_PERMISSION,
          'OWNER_NOT_QUALIFIED',
          'The CAPA owner must be an active user who holds the quality.manage_capa permission',
        )
      }

      const rootCauseChanging = dto.rootCause !== undefined || dto.rootCauseCategory !== undefined
      const nextRootCause = dto.rootCause?.trim() ?? existing.rootCause ?? existing.title
      const nextCategory = rootCauseChanging
        ? resolveRootCauseCategory(
            dto.rootCauseCategory ?? existing.rootCauseCategory ?? '',
            dto.rootCauseOther,
          )
        : undefined

      const nextCorrectiveDue =
        dto.correctiveActionDueDate !== undefined
          ? new Date(dto.correctiveActionDueDate)
          : existing.correctiveActionDueDate
      const nextPreventiveAction =
        dto.preventiveAction !== undefined
          ? dto.preventiveAction.trim() || null
          : existing.preventiveAction
      const nextPreventiveDue =
        dto.preventiveActionDueDate !== undefined
          ? new Date(dto.preventiveActionDueDate)
          : existing.preventiveActionDueDate
      if (nextPreventiveAction && !nextPreventiveDue) {
        throw new BadRequestException({
          code: 'PREVENTIVE_DUE_DATE_REQUIRED',
          message: 'A due date is required for the preventive action',
        })
      }

      const dueChanged =
        nextCorrectiveDue?.getTime() !== existing.correctiveActionDueDate?.getTime() ||
        nextPreventiveDue?.getTime() !== existing.preventiveActionDueDate?.getTime()

      const updated = await tx.capa.update({
        where: { id },
        data: {
          ...(rootCauseChanging
            ? {
                rootCause: nextRootCause,
                rootCauseCategory: nextCategory,
              }
            : {}),
          correctiveAction: dto.correctiveAction,
          preventiveAction: dto.preventiveAction !== undefined ? nextPreventiveAction : undefined,
          ownerUserId: dto.ownerUserId,
          correctiveActionDueDate:
            dto.correctiveActionDueDate !== undefined ? nextCorrectiveDue : undefined,
          preventiveActionDueDate:
            dto.preventiveActionDueDate !== undefined ? nextPreventiveDue : undefined,
          ...(dto.correctiveActionDueDate !== undefined ? { dueDate: nextCorrectiveDue } : {}),
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
        newValue: { ...dto },
        ip: meta.ip,
      })

      if (ownerChanging) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'capa_owner_reassigned',
          recordType: CAPA_RECORD_TYPE,
          recordId: id,
          oldValue: { ownerUserId: existing.ownerUserId },
          newValue: { ownerUserId: dto.ownerUserId },
          ip: meta.ip,
        })
      }
      if (dueChanged) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'capa_due_dates_changed',
          recordType: CAPA_RECORD_TYPE,
          recordId: id,
          oldValue: {
            correctiveActionDueDate: existing.correctiveActionDueDate,
            preventiveActionDueDate: existing.preventiveActionDueDate,
          },
          newValue: {
            correctiveActionDueDate: nextCorrectiveDue,
            preventiveActionDueDate: nextPreventiveDue,
          },
          ip: meta.ip,
        })
      }
      if (rootCauseChanging) {
        await this.auditService.log(tx, {
          companyId,
          actorUserId: actor.sub,
          action: 'capa_root_cause_changed',
          recordType: CAPA_RECORD_TYPE,
          recordId: id,
          oldValue: {
            rootCause: existing.rootCause,
            rootCauseCategory: existing.rootCauseCategory,
          },
          newValue: { rootCause: nextRootCause, rootCauseCategory: nextCategory },
          ip: meta.ip,
        })
      }

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
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      this.assertNotClosed(existing)
      this.assertActable(actor, permissions, existing)

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
   * Designates or reassigns the regulatory approver for a CAPA that needs
   * regulatory approval. Creator, current owner, or a manager only.
   */
  async reassignRegulatoryApprover(
    actor: AuthenticatedUser,
    id: string,
    dto: ReassignCapaRegulatoryApproverDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      this.assertNotClosed(existing)
      this.assertCanReassign(actor, permissions, existing)
      if (!existing.requiresRegulatoryApproval) {
        throw new ConflictException({
          code: 'REGULATORY_APPROVAL_NOT_REQUIRED',
          message: 'This CAPA is not marked as needing regulatory approval',
        })
      }
      if (existing.regulatoryApprovedAt) {
        throw new ConflictException({
          code: 'ALREADY_REGULATORY_APPROVED',
          message: 'Regulatory approval is already recorded — the approver cannot be changed',
        })
      }
      await assertUserHoldsPermission(
        tx,
        companyId,
        dto.regulatoryApproverUserId,
        REGULATORY_APPROVER_PERMISSION,
        'REGULATORY_APPROVER_NOT_QUALIFIED',
        'The regulatory approver must be an active user who holds the regulatory.manage_registrations permission',
      )

      const updated = await tx.capa.update({
        where: { id },
        data: { regulatoryApproverUserId: dto.regulatoryApproverUserId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: existing.regulatoryApproverUserId
          ? 'capa_regulatory_approver_reassigned'
          : 'capa_regulatory_approver_assigned',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        oldValue: { regulatoryApproverUserId: existing.regulatoryApproverUserId },
        newValue: { regulatoryApproverUserId: dto.regulatoryApproverUserId },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * The cross-functional sign-off before implementation begins — "QA
   * plus, where the action touches a regulated filing, a Reg-side
   * approver too". `requiresRegulatoryApproval` falls back to the value set
   * at creation; it can still be changed here. A required regulatory
   * approver must already be designated.
   */
  async approve(
    actor: AuthenticatedUser,
    id: string,
    dto: ApproveCapaDto,
    meta: RequestMeta,
  ): Promise<Capa> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      this.assertNotClosed(existing)
      this.assertActable(actor, permissions, existing)
      if (existing.approvedAt) {
        throw new ConflictException({
          code: 'ALREADY_APPROVED',
          message: 'This CAPA is already approved',
        })
      }

      const requiresRegulatoryApproval =
        dto.requiresRegulatoryApproval ?? existing.requiresRegulatoryApproval
      if (requiresRegulatoryApproval && !existing.regulatoryApproverUserId) {
        throw new ConflictException({
          code: 'REGULATORY_APPROVER_REQUIRED',
          message: 'Assign a regulatory approver before this CAPA can be approved',
        })
      }

      const updated = await tx.capa.update({
        where: { id },
        data: {
          approvedBy: actor.sub,
          approvedAt: new Date(),
          requiresRegulatoryApproval,
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

  /**
   * The regulatory-side approval. Requires `regulatory.manage_registrations`.
   * If an approver is designated, only that approver (or a manager) may act;
   * a CAPA with no designated approver keeps the pre-Pass-A2 behaviour.
   */
  async regulatoryApprove(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    if (!permissions.has(REGULATORY_APPROVER_PERMISSION)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to give regulatory approval',
      })
    }
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      if (
        existing.regulatoryApproverUserId &&
        existing.regulatoryApproverUserId !== actor.sub &&
        !isCapaManagerTier(permissions)
      ) {
        throw forbidCapaAction('Only the designated regulatory approver can give this approval')
      }
      if (!existing.requiresRegulatoryApproval) {
        throw new ConflictException({
          code: 'REGULATORY_APPROVAL_NOT_REQUIRED',
          message: 'This CAPA was not marked as needing regulatory approval',
        })
      }
      if (existing.regulatoryApprovedAt) {
        throw new ConflictException({
          code: 'ALREADY_REGULATORY_APPROVED',
          message: 'Regulatory approval is already recorded for this CAPA',
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
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      this.assertNotClosed(existing)
      this.assertActable(actor, permissions, existing)
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
    const permissions = await this.permissionsFor(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'A closed CAPA cannot have a new effectiveness check recorded',
        })
      }
      this.assertActable(actor, permissions, existing)

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

  /**
   * Attaches closing evidence (a photo, a signed form, a test report — any
   * file) to a CAPA through the existing server-proxied document path, then
   * writes a CAPA-level audit entry. `close()` refuses until at least one
   * such document exists.
   */
  async uploadEvidence(
    actor: AuthenticatedUser,
    id: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<DirectUploadResult> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    if (!permissions.has(CAPA_MANAGE_PERMISSION)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to attach CAPA evidence',
      })
    }
    const capa = await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      this.assertNotClosed(existing)
      this.assertActable(actor, permissions, existing)
      return existing
    })

    const result = await this.documentsService.uploadDirect(
      actor,
      CAPA_EVIDENCE_RECORD_TYPE,
      capa.id,
      file,
      { title: file.originalname },
      meta,
    )

    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'capa_evidence_attached',
        recordType: CAPA_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: result.document.id, filename: file.originalname },
        ip: meta.ip,
      }),
    )

    return result
  }

  async close(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Capa> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    if (!permissions.has(CAPA_CLOSE_PERMISSION)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to close CAPAs',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, existing)
      if (existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_CLOSED',
          message: 'This CAPA is already closed',
        })
      }
      this.assertActable(actor, permissions, existing)
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
      const evidenceCount = await tx.document.count({
        where: { companyId, recordType: CAPA_EVIDENCE_RECORD_TYPE, recordId: id },
      })
      if (evidenceCount === 0) {
        throw new ConflictException({
          code: 'EVIDENCE_REQUIRED',
          message: 'Attach evidence of the corrective action before this CAPA can be closed',
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
        newValue: {
          effectivenessCheckResult: existing.effectivenessCheckResult,
          evidenceDocumentCount: evidenceCount,
        },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(actor: AuthenticatedUser, query: ListCapasQueryDto): Promise<PaginatedResult<Capa>> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.CapaWhereInput = {
        companyId,
        ...(query.sourceRecordType ? { sourceRecordType: query.sourceRecordType } : {}),
        ...(query.status ? { status: query.status as CapaStatus } : {}),
        ...(isCapaManagerTier(permissions)
          ? {}
          : {
              OR: [
                { ownerUserId: actor.sub },
                { createdBy: actor.sub },
                { regulatoryApproverUserId: actor.sub },
              ],
            }),
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
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await this.loadCapa(tx, companyId, id)
      this.assertVisible(actor, permissions, found)
      return found
    })
  }

  /**
   * Every CAPA opened against one quality-event record (e.g. a Deviation),
   * filtered by the same visibility rule as `list()`, with the owner's name
   * resolved for display. Owner is a same-company user, so the relation
   * include is RLS-safe inside this tenant transaction.
   */
  async listForSource(
    actor: AuthenticatedUser,
    sourceRecordType: string,
    sourceRecordId: string,
  ): Promise<(Capa & { owner: { id: string; fullName: string } | null })[]> {
    const companyId = requireCompany(actor)
    const permissions = await this.permissionsFor(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.capa.findMany({
        where: {
          companyId,
          sourceRecordType,
          sourceRecordId,
          ...(isCapaManagerTier(permissions)
            ? {}
            : {
                OR: [
                  { ownerUserId: actor.sub },
                  { createdBy: actor.sub },
                  { regulatoryApproverUserId: actor.sub },
                ],
              }),
        },
        include: { owner: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    )
  }

  /** Active company users who hold `quality.manage_capa` — the only people a CAPA owner can be. Names only. */
  async listAssignableOwners(
    actor: AuthenticatedUser,
  ): Promise<{ id: string; fullName: string }[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) =>
      (await listUsersHoldingPermission(tx, companyId, CAPA_MANAGE_PERMISSION)).map((u) => ({
        id: u.id,
        fullName: u.fullName,
      })),
    )
  }

  /** Active company users who hold `regulatory.manage_registrations` — the only people a regulatory approver can be. Names only. */
  async listAssignableRegulatoryApprovers(
    actor: AuthenticatedUser,
  ): Promise<{ id: string; fullName: string }[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) =>
      (await listUsersHoldingPermission(tx, companyId, REGULATORY_APPROVER_PERMISSION)).map(
        (u) => ({
          id: u.id,
          fullName: u.fullName,
        }),
      ),
    )
  }

  /**
   * The daily overdue-CAPA scan. Escalates on either the corrective or the
   * preventive due date, whichever has passed on a non-closed CAPA.
   */
  async escalateOverdue(): Promise<{ companiesScanned: number; capasEscalated: number }> {
    const now = new Date()
    const overdue = await this.rls.runWithSystemAccess((tx) =>
      tx.capa.findMany({
        where: {
          status: { not: 'closed' },
          OR: [{ correctiveActionDueDate: { lt: now } }, { preventiveActionDueDate: { lt: now } }],
        },
        select: { id: true, companyId: true, title: true },
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
