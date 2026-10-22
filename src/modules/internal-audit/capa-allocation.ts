import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { isListedRootCauseKey, OTHER_ROOT_CAUSE_KEY } from '../quality/root-cause-categories.const'
import { CapaAllocationDto } from './dto/capa-allocation.dto'

/**
 * QualCloud Phase 1 Pass A2 — the single home of the CAPA allocation rules
 * (owner required, separate corrective/preventive due dates, root cause +
 * curated category or typed "other", designated regulatory approver when
 * one is required). Every CAPA opener calls `normalizeAllocation()` and the
 * candidate checks below, so the rule cannot drift between the CAPA form,
 * Deviation, OOS/OOT, Complaint and Audit Finding paths.
 */
export const CAPA_MANAGE_PERMISSION = 'quality.manage_capa'
export const CAPA_VIEW_ALL_PERMISSION = 'quality.view_all'
export const CAPA_CLOSE_PERMISSION = 'quality.close_capa'
export const REGULATORY_APPROVER_PERMISSION = 'regulatory.manage_registrations'

export interface NormalizedAllocation {
  /** Derived from `rootCause` so a CAPA can never have an empty title. */
  title: string
  rootCause: string
  /** A listed category key, or the typed free text when the caller chose "other". */
  rootCauseCategory: string
  correctiveAction: string
  preventiveAction: string | null
  ownerUserId: string
  correctiveActionDueDate: Date
  preventiveActionDueDate: Date | null
  /** Legacy single due date, mirrored from `correctiveActionDueDate` for backward compatibility. */
  dueDate: Date
  requiresRegulatoryApproval: boolean
  regulatoryApproverUserId: string | null
}

function parseIsoDate(value: string, code: string, label: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code, message: `${label} must be a valid date` })
  }
  return date
}

/** Shared by `normalizeAllocation()` and `CapaService.update()` — one validation of the category/"other" pairing. */
export function resolveRootCauseCategory(
  category: string | undefined,
  other: string | undefined,
): string {
  const categoryInput = category?.trim() ?? ''
  if (categoryInput === OTHER_ROOT_CAUSE_KEY) {
    const typed = other?.trim() ?? ''
    if (typed.length === 0) {
      throw new BadRequestException({
        code: 'ROOT_CAUSE_OTHER_REQUIRED',
        message: 'Type the root-cause category when "Other" is chosen',
      })
    }
    return typed
  }
  if (isListedRootCauseKey(categoryInput)) return categoryInput
  throw new BadRequestException({
    code: 'INVALID_ROOT_CAUSE_CATEGORY',
    message: 'Choose a root-cause category from the list',
  })
}

/** Pure — no I/O. Throws `BadRequestException` with a stable `code` for each rule. */
export function normalizeAllocation(dto: CapaAllocationDto): NormalizedAllocation {
  const rootCause = dto.rootCause?.trim() ?? ''
  if (rootCause.length === 0) {
    throw new BadRequestException({
      code: 'ROOT_CAUSE_REQUIRED',
      message: 'A root cause is required',
    })
  }

  const rootCauseCategory = resolveRootCauseCategory(dto.rootCauseCategory, dto.rootCauseOther)

  const correctiveAction = dto.correctiveAction?.trim() ?? ''
  if (correctiveAction.length === 0) {
    throw new BadRequestException({
      code: 'CORRECTIVE_ACTION_REQUIRED',
      message: 'A corrective action is required',
    })
  }

  const correctiveActionDueDate = parseIsoDate(
    dto.correctiveActionDueDate,
    'CORRECTIVE_DUE_DATE_INVALID',
    'The corrective action due date',
  )

  const preventiveAction = dto.preventiveAction?.trim() || null
  let preventiveActionDueDate: Date | null = null
  if (preventiveAction) {
    if (!dto.preventiveActionDueDate) {
      throw new BadRequestException({
        code: 'PREVENTIVE_DUE_DATE_REQUIRED',
        message: 'A due date is required for the preventive action',
      })
    }
    preventiveActionDueDate = parseIsoDate(
      dto.preventiveActionDueDate,
      'PREVENTIVE_DUE_DATE_INVALID',
      'The preventive action due date',
    )
  }

  const requiresRegulatoryApproval = dto.requiresRegulatoryApproval === true
  const regulatoryApproverUserId = requiresRegulatoryApproval
    ? (dto.regulatoryApproverUserId ?? null)
    : null
  if (requiresRegulatoryApproval && !regulatoryApproverUserId) {
    throw new BadRequestException({
      code: 'REGULATORY_APPROVER_REQUIRED',
      message: 'Assign a regulatory approver when this CAPA needs regulatory approval',
    })
  }

  return {
    title: rootCause.slice(0, 200),
    rootCause,
    rootCauseCategory,
    correctiveAction,
    preventiveAction,
    ownerUserId: dto.ownerUserId,
    correctiveActionDueDate,
    preventiveActionDueDate,
    dueDate: correctiveActionDueDate,
    requiresRegulatoryApproval,
    regulatoryApproverUserId,
  }
}

/** Users in this company who are active AND hold `permission` through one of their roles. Name/email only, never the full row. */
export async function listUsersHoldingPermission(
  tx: Prisma.TransactionClient,
  companyId: string,
  permission: string,
): Promise<{ id: string; fullName: string; email: string }[]> {
  const roles = await tx.role.findMany({
    where: { permissions: { some: { permission: { key: permission } } } },
    select: { key: true },
  })
  const roleKeys = roles.map((r) => r.key)
  if (roleKeys.length === 0) return []
  return tx.user.findMany({
    where: { companyId, status: 'active', roleKeys: { hasSome: roleKeys } },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: 'asc' },
  })
}

/** Rejects with a stable code unless `userId` is an active company user holding `permission`. */
export async function assertUserHoldsPermission(
  tx: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  permission: string,
  code: string,
  message: string,
): Promise<void> {
  const holders = await listUsersHoldingPermission(tx, companyId, permission)
  if (!holders.some((h) => h.id === userId)) {
    throw new BadRequestException({ code, message })
  }
}

/**
 * The CAPA visibility/action rule (documented in `CapaService`'s own doc
 * comment, and in the Pass A2 testing guide). `isManagerTier` keeps every
 * existing manager's access exactly as before; anyone else only ever sees or
 * acts on a CAPA they are a named participant on.
 */
export function isCapaManagerTier(permissions: Set<string>): boolean {
  return permissions.has(CAPA_VIEW_ALL_PERMISSION) || permissions.has(CAPA_MANAGE_PERMISSION)
}

export function isCapaParticipant(
  actorUserId: string,
  capa: {
    ownerUserId: string | null
    createdBy: string | null
    regulatoryApproverUserId: string | null
  },
): boolean {
  return (
    capa.ownerUserId === actorUserId ||
    capa.createdBy === actorUserId ||
    capa.regulatoryApproverUserId === actorUserId
  )
}

export function forbidCapaAction(
  message = 'Only the CAPA owner, its creator, or a quality manager can act on this CAPA',
): ForbiddenException {
  return new ForbiddenException({ code: 'CAPA_NOT_ASSIGNED', message })
}
