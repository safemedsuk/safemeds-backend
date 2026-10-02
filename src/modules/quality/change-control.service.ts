import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ChangeControl, Prisma, RegVariationType } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RegVariationService } from '../regulatory/reg-variation.service'
import { WorkflowService } from '../workflow/workflow.service'
import { AssessChangeImpactDto } from './dto/assess-change-impact.dto'
import { CreateChangeControlDto } from './dto/create-change-control.dto'
import { ListChangeControlsQueryDto } from './dto/list-change-controls-query.dto'
import { OpenLinkedVariationDto } from './dto/open-linked-variation.dto'
import { RecordChangeApprovalDto } from './dto/record-change-approval.dto'
import { RecordChangeImplementationDto } from './dto/record-change-implementation.dto'

export interface RequestMeta {
  ip?: string
}

export const QUALITY_CHANGE_CONTROL_RECORD_TYPE = 'quality_change_control'

/**
 * `crossFunctionalApprovals`'s own element shape — one row per approver
 * role, appended (never duplicated per role) by `recordApproval()`.
 */
export interface ChangeControlApprovalEntry {
  role: string
  userId: string
  approvedAt: string
  note?: string
}

type DecryptedChangeControl = Omit<ChangeControl, 'changeDescriptionEncrypted'> & {
  changeDescription: string | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Change controls are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

async function nextChangeNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
  const count = await tx.changeControl.count({
    where: { companyId, changeNumber: { startsWith: `CC-${year}-` } },
  })
  return `CC-${year}-${String(count + 1).padStart(5, '0')}`
}

/** Every role a change control's own impact assessment requires an approval from — `QUALITY_MANAGER` always, plus `REGULATORY_AFFAIRS_OFFICER` once `regulatoryImpact.impacted` is true. No "Production" approver role exists in this platform's tenant taxonomy, so it is honestly not modelled here. Exported for `QualityWorkflowGuards`' own `impact_assessment → approved` guard, so the required-roles logic lives in exactly one place. */
export function requiredApproverRoles(impactAssessment: Prisma.JsonValue | null): string[] {
  const roles = ['QUALITY_MANAGER']
  if (impactAssessment && typeof impactAssessment === 'object' && !Array.isArray(impactAssessment)) {
    const regulatory = (impactAssessment as Record<string, unknown>).regulatoryImpact
    if (regulatory && typeof regulatory === 'object' && (regulatory as Record<string, unknown>).impacted === true) {
      roles.push('REGULATORY_AFFAIRS_OFFICER')
    }
  }
  return roles
}

function mapChangeTypeToVariationType(changeType: string): RegVariationType {
  return changeType === 'major' || changeType === 'critical' ? RegVariationType.major : RegVariationType.minor
}

/**
 * QualCloud (Phase 13) Stage 4 — Change Control. Master lifecycle stage
 * 5. `create()` instantiates a real `quality_change_control`
 * `WorkflowInstance`, matching every other quality record type's own
 * established "the generic engine, not a per-domain re-implementation"
 * precedent. `assessImpact()`/`recordApproval()`/`recordImplementation()`
 * are all plain data writes, not transitions themselves — the actual
 * `impact_assessment → approved` transition is what
 * `QualityWorkflowGuards` gates on the recorded approvals, and
 * `verifying → closed` on a recorded `verificationResult`.
 * `openLinkedVariation()` is deliberately a standalone, top-level action
 * (never called from inside a guard's own already-open transaction) —
 * `RegVariationService.create()` opens its own transactions internally,
 * so nesting it inside a guard would risk exactly the kind of
 * transaction-nesting problem this codebase's own "do the slow/
 * cross-service part outside the guard's transaction" discipline
 * (Stage 12's PDF-generation-then-DB-write split) already warns against.
 */
@Injectable()
export class ChangeControlService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly workflowService: WorkflowService,
    private readonly textEncryption: TextEncryptionService,
    private readonly regVariationService: RegVariationService,
  ) {}

  private decrypt(row: ChangeControl): DecryptedChangeControl {
    const { changeDescriptionEncrypted, ...rest } = row
    return {
      ...rest,
      changeDescription: changeDescriptionEncrypted
        ? this.textEncryption.decrypt(changeDescriptionEncrypted)
        : null,
    }
  }

  async list(
    actor: AuthenticatedUser,
    query: ListChangeControlsQueryDto,
  ): Promise<PaginatedResult<DecryptedChangeControl>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ChangeControlWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { changeNumber: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.scope ? { scope: query.scope } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.changeControl.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.changeControl.count({ where }),
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
  ): Promise<DecryptedChangeControl & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.changeControl.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Change control not found' })
      const workflowInstance = await tx.workflowInstance.findFirst({
        where: { recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE, recordId: id },
      })
      return { ...this.decrypt(found), workflowInstanceId: workflowInstance?.id ?? null }
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateChangeControlDto,
    meta: RequestMeta,
  ): Promise<DecryptedChangeControl> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const changeNumber = await nextChangeNumber(tx, companyId)

      const created = await tx.changeControl.create({
        data: {
          id: newId(),
          companyId,
          changeNumber,
          title: dto.title,
          changeType: dto.changeType,
          changeDescriptionEncrypted: dto.changeDescription
            ? this.textEncryption.encrypt(dto.changeDescription)
            : null,
          scope: dto.scope,
          productId: dto.productId ?? null,
          batchId: dto.batchId ?? null,
          equipmentId: dto.equipmentId ?? null,
          supplierId: dto.supplierId ?? null,
          sopId: dto.sopId ?? null,
          affectedProductRegistrationId: dto.affectedProductRegistrationId ?? null,
          status: 'proposed',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'change_control_created',
        recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        recordId: created.id,
        newValue: { changeNumber: created.changeNumber, title: created.title },
        ip: meta.ip,
      })

      await this.workflowService.instantiate(
        actor,
        QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        created.id,
        null,
        meta,
      )

      return this.decrypt(created)
    })
  }

  /**
   * A real structured checklist, not free text — see `AssessChangeImpactDto`'s
   * own doc comment. A plain data write, runnable any time before
   * `approved` (not itself the `impact_assessment` transition).
   */
  async assessImpact(
    actor: AuthenticatedUser,
    id: string,
    dto: AssessChangeImpactDto,
    meta: RequestMeta,
  ): Promise<DecryptedChangeControl> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.changeControl.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Change control not found' })
      if (existing.status === 'approved' || existing.status === 'implementing' || existing.status === 'verifying' || existing.status === 'closed') {
        throw new ConflictException({
          code: 'ALREADY_APPROVED',
          message: 'The impact assessment can no longer be changed once this change control has been approved',
        })
      }

      const updated = await tx.changeControl.update({
        where: { id },
        data: { impactAssessment: dto as unknown as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'change_control_impact_assessed',
        recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        recordId: id,
        newValue: { impactAssessment: dto },
        ip: meta.ip,
      })

      return this.decrypt(updated)
    })
  }

  /**
   * Appends (or replaces, if the same role already approved) an entry to
   * `crossFunctionalApprovals` — the actor's own current, denormalized
   * role-at-action, matching this codebase's own "role-at-time-of-action"
   * signature precedent. Not itself signature-gated — the real
   * compliance sign-off is the `impact_assessment → approved` transition
   * this unblocks, which is.
   */
  async recordApproval(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordChangeApprovalDto,
    meta: RequestMeta,
  ): Promise<DecryptedChangeControl> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.changeControl.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Change control not found' })

      const actorRole = actor.roleKeys.find((r) => requiredApproverRoles(existing.impactAssessment).includes(r))
      if (!actorRole) {
        throw new ForbiddenException({
          code: 'NOT_A_REQUIRED_APPROVER',
          message: 'Your role is not one of the approvers this change control currently requires',
        })
      }

      const existingApprovals = Array.isArray(existing.crossFunctionalApprovals)
        ? (existing.crossFunctionalApprovals as unknown as ChangeControlApprovalEntry[])
        : []
      const withoutThisRole = existingApprovals.filter((a) => a.role !== actorRole)
      const nextApprovals: ChangeControlApprovalEntry[] = [
        ...withoutThisRole,
        { role: actorRole, userId: actor.sub, approvedAt: new Date().toISOString(), note: dto.note },
      ]

      const updated = await tx.changeControl.update({
        where: { id },
        data: { crossFunctionalApprovals: nextApprovals as unknown as Prisma.InputJsonValue },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'change_control_approval_recorded',
        recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        recordId: id,
        newValue: { role: actorRole },
        ip: meta.ip,
      })

      return this.decrypt(updated)
    })
  }

  async recordImplementation(
    actor: AuthenticatedUser,
    id: string,
    dto: RecordChangeImplementationDto,
    meta: RequestMeta,
  ): Promise<DecryptedChangeControl> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.changeControl.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Change control not found' })

      const updated = await tx.changeControl.update({
        where: { id },
        data: {
          ...(dto.implementationRecord !== undefined
            ? { implementationRecord: dto.implementationRecord }
            : {}),
          ...(dto.verificationResult !== undefined
            ? { verificationResult: dto.verificationResult }
            : {}),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'change_control_implementation_recorded',
        recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        recordId: id,
        newValue: { hasVerificationResult: !!dto.verificationResult },
        ip: meta.ip,
      })

      return this.decrypt(updated)
    })
  }

  /**
   * The literal cross-module join the Build Priority doc calls the
   * moat — opens a real `RegVariation` via RegCloud's own, already-built
   * `RegVariationService.create()`. Deliberately two sequential, fast,
   * top-level operations rather than one atomic transaction — the same
   * tolerance this codebase already established for `RegVariationService
   * .create()`'s own dossier-then-wrapper-row split.
   */
  async openLinkedVariation(
    actor: AuthenticatedUser,
    id: string,
    dto: OpenLinkedVariationDto,
    meta: RequestMeta,
  ): Promise<DecryptedChangeControl> {
    const companyId = requireCompany(actor)
    const existing = await this.rls.runAsCompany(companyId, (tx) =>
      tx.changeControl.findFirst({ where: { id, companyId } }),
    )
    if (!existing)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Change control not found' })
    if (existing.linkedRegVariationId) {
      throw new ConflictException({
        code: 'ALREADY_LINKED',
        message: 'This change control already has a linked regulatory variation',
      })
    }
    const impactAssessment = existing.impactAssessment as { regulatoryImpact?: { impacted?: boolean } } | null
    if (!impactAssessment?.regulatoryImpact?.impacted) {
      throw new ConflictException({
        code: 'NO_REGULATORY_IMPACT',
        message: 'This change control has not been flagged as having a regulatory impact',
      })
    }
    const productRegistrationId = dto.productRegistrationId ?? existing.affectedProductRegistrationId
    if (!productRegistrationId) {
      throw new BadRequestException({
        code: 'PRODUCT_REGISTRATION_REQUIRED',
        message: 'The affected product registration must be known before a variation can be opened',
      })
    }

    const variation = await this.regVariationService.create(
      actor,
      {
        productRegistrationId,
        variationType: dto.variationType ?? mapChangeTypeToVariationType(existing.changeType),
      },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.changeControl.update({
        where: { id },
        data: { linkedRegVariationId: variation.id },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'change_control_variation_opened',
        recordType: QUALITY_CHANGE_CONTROL_RECORD_TYPE,
        recordId: id,
        newValue: { regVariationId: variation.id, displayCode: variation.displayCode },
        ip: meta.ip,
      })
      return this.decrypt(updated)
    })
  }
}
