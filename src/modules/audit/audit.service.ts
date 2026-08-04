import { ForbiddenException, forwardRef, Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { PrismaService } from '../../prisma/prisma.service'
import { RolesService } from '../roles/roles.service'
import { QueryAuditDto } from './dto/query-audit.dto'

/**
 * `oldValue`/`newValue` accept a plain `Record<string, unknown>` (as
 * produced by `diffForAudit`, or hand-built by callers) rather than the
 * stricter `Prisma.InputJsonValue` — this service is the trusted boundary
 * that redacts and casts on the way into `auditEntry.create()`, so callers
 * don't need to fight Prisma's recursive JSON type for plain data objects.
 */
export interface AuditLogEntry {
  companyId?: string | null
  actorUserId?: string | null
  actorType?: 'user' | 'system'
  action: string
  recordType: string
  recordId?: string | null
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  ip?: string | null
}

const REDACTED = '[REDACTED]'

/**
 * Deny-list of field names that must never reach `audit_entry` in the
 * clear, no matter what a caller passes — hashes and secrets belong in
 * their own tables, not in a human-readable compliance log. Matched
 * case-sensitively against top-level keys of `oldValue`/`newValue`.
 */
const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'password',
  'currentPassword',
  'newPassword',
  'adminPassword',
  'adminPasswordConfirm',
  'adminPasswordHash',
  'secretEncrypted',
  'secret',
  'recoveryCodesHashed',
  'recoveryCodes',
  'tokenHash',
  'token',
  'refreshToken',
  'accessToken',
  'verificationCodeHash',
  'mfaEncryptionKey',
])

function redactValue(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined
  }
  const redacted: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    redacted[key] = SENSITIVE_FIELDS.has(key) && val !== undefined && val !== null ? REDACTED : val
  }
  return redacted as Prisma.InputJsonValue
}

/**
 * Reduces two field snapshots of the same record to only the fields that
 * actually changed, so `audit_entry.old_value`/`new_value` stay minimal
 * diffs rather than full row dumps — e.g. a security-policy update that
 * only touches `sessionTimeoutMinutes` shouldn't also re-record
 * `minPasswordLength` as if it changed too. Sensitive fields are redacted
 * before comparison is even meaningful (a hash always differs from another
 * hash) via `AuditService.log()`'s own redaction pass, applied afterward.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { oldValue?: Record<string, unknown>; newValue?: Record<string, unknown> } {
  if (!before && !after) {
    return {}
  }

  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const oldValue: Record<string, unknown> = {}
  const newValue: Record<string, unknown> = {}
  let changed = false

  for (const key of keys) {
    const a = before?.[key]
    const b = after?.[key]
    if (JSON.stringify(a) === JSON.stringify(b)) {
      continue
    }
    changed = true
    oldValue[key] = a
    newValue[key] = b
  }

  return changed ? { oldValue, newValue } : {}
}

export interface AuditEntryDto {
  id: string
  companyId: string | null
  actorUserId: string | null
  actorName: string | null
  actorType: 'user' | 'system'
  action: string
  recordType: string
  recordId: string | null
  oldValue: unknown
  newValue: unknown
  ip: string | null
  occurredAt: Date
}

function toAuditEntryDto(
  row: Prisma.AuditEntryGetPayload<object>,
): Omit<AuditEntryDto, 'actorName'> {
  return {
    id: row.id,
    companyId: row.companyId,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    action: row.action,
    recordType: row.recordType,
    recordId: row.recordId,
    oldValue: row.oldValue,
    newValue: row.newValue,
    ip: row.ip,
    occurredAt: row.occurredAt,
  }
}

/**
 * Append-only audit write path (Phase 3.1 — DB-level immutability is
 * enforced by the `audit_entry` REVOKE + trigger in the phase3_1 migration,
 * this is the application-level half). Always call with a transaction
 * client so the audit entry commits or rolls back atomically with the
 * change it records — see `RlsService` for the transaction/ALS pattern
 * used throughout the codebase.
 *
 * Query side (3.2): `audit_entry` deliberately has no Postgres RLS policy
 * (unlike `app_user`/`security_policy`/`invitation` in Phase 2.3) — a
 * meaningful share of entries are platform-level with `company_id: null`
 * (registration rejections, platform staff actions), which a FORCE-RLS
 * policy keyed on `app.company_id` can't cleanly represent for a raw,
 * non-RLS-context `$transaction` write. Tenant scoping for reads is
 * therefore enforced here, in application code, by hard-forcing
 * `companyId` from the caller's own session — never trusting a query param
 * for a tenant caller.
 */
@Injectable()
export class AuditService {
  constructor(
    // See `RlsService`'s constructor comment — this is the other half of a
    // genuine, intentional cycle, broken with `forwardRef` on both sides.
    @Inject(forwardRef(() => RlsService))
    private readonly rls: RlsService,
    private readonly rolesService: RolesService,
  ) {}

  async log(tx: Prisma.TransactionClient | PrismaService, entry: AuditLogEntry): Promise<void> {
    await tx.auditEntry.create({
      data: {
        id: newId(),
        companyId: entry.companyId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorType: entry.actorType ?? 'user',
        action: entry.action,
        recordType: entry.recordType,
        recordId: entry.recordId ?? null,
        oldValue: redactValue(entry.oldValue),
        newValue: redactValue(entry.newValue),
        ip: entry.ip ?? null,
      },
    })
  }

  /** `GET /audit` — tenant callers always scoped to their own company; platform callers need `platform.audit.read` to see anything cross-tenant. */
  async query(
    actor: AuthenticatedUser,
    dto: QueryAuditDto,
  ): Promise<PaginatedResult<AuditEntryDto>> {
    const where: Prisma.AuditEntryWhereInput = {}
    if (dto.recordType) where.recordType = dto.recordType
    if (dto.recordId) where.recordId = dto.recordId
    if (dto.actorId) where.actorUserId = dto.actorId
    if (dto.action) where.action = dto.action
    if (dto.from || dto.to) {
      where.occurredAt = {
        ...(dto.from ? { gte: new Date(dto.from) } : {}),
        ...(dto.to ? { lte: new Date(dto.to) } : {}),
      }
    }

    if (actor.companyId) {
      const page = await this.rls.runAsCompany(actor.companyId, (tx) =>
        this.findPage(tx, { ...where, companyId: actor.companyId }, dto),
      )
      return this.withActorNames(page)
    }

    if (dto.companyId) {
      await this.assertPlatformAuditAccess(actor)
      const page = await this.rls.runAsCompany(dto.companyId, (tx) =>
        this.findPage(tx, { ...where, companyId: dto.companyId }, dto),
      )
      return this.withActorNames(page)
    }

    await this.assertPlatformAuditAccess(actor)
    const page = await this.rls.runWithSystemAccess((tx) => this.findPage(tx, where, dto))
    return this.withActorNames(page)
  }

  /** `GET /records/:type/:id/history` — the reusable Activity-tab data source, same tenant-scoping rule as `query()`. */
  async history(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
    pagination: QueryAuditDto,
  ): Promise<PaginatedResult<AuditEntryDto>> {
    const where: Prisma.AuditEntryWhereInput = { recordType, recordId }

    if (actor.companyId) {
      const page = await this.rls.runAsCompany(actor.companyId, (tx) =>
        this.findPage(tx, { ...where, companyId: actor.companyId }, pagination),
      )
      return this.withActorNames(page)
    }

    await this.assertPlatformAuditAccess(actor)
    const page = await this.rls.runWithSystemAccess((tx) => this.findPage(tx, where, pagination))
    return this.withActorNames(page)
  }

  private async findPage(
    tx: Prisma.TransactionClient,
    where: Prisma.AuditEntryWhereInput,
    pagination: Pick<QueryAuditDto, 'page' | 'limit'>,
  ): Promise<PaginatedResult<Omit<AuditEntryDto, 'actorName'>>> {
    const page = pagination.page ?? 1
    const limit = pagination.limit ?? 25

    const [rows, total] = await Promise.all([
      tx.auditEntry.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      tx.auditEntry.count({ where }),
    ])

    return paginate(rows.map(toAuditEntryDto), total, { page, limit })
  }

  /**
   * Resolves `actorName` in a second, separate query — deliberately NOT a
   * Prisma relational `include` on `actor`, because that join would run
   * inside the same RLS-bound transaction as the audit rows themselves,
   * and a platform-staff actor's `app_user` row (`company_id: null`) is
   * invisible under a tenant's `runAsCompany` context. Knowing *who*
   * performed an already-company-scoped audited action is safe to reveal
   * regardless of that actor's own company boundary, so this runs under
   * `runWithSystemAccess` — a separate, un-nested transaction (the RLS ALS
   * context from the page fetch above has already exited by the time this
   * runs, so this genuinely bypasses RLS rather than reusing that tx).
   */
  private async withActorNames(
    page: PaginatedResult<Omit<AuditEntryDto, 'actorName'>>,
  ): Promise<PaginatedResult<AuditEntryDto>> {
    const actorIds = Array.from(
      new Set(page.data.map((e) => e.actorUserId).filter((id): id is string => id !== null)),
    )

    const namesById = actorIds.length
      ? await this.rls.runWithSystemAccess(async (tx) => {
          const users = await tx.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, fullName: true },
          })
          return new Map(users.map((u) => [u.id, u.fullName]))
        })
      : new Map<string, string>()

    const data = page.data.map((entry) => ({
      ...entry,
      actorName: entry.actorUserId ? (namesById.get(entry.actorUserId) ?? null) : null,
    }))
    return new PaginatedResult(data, page.meta)
  }

  private async assertPlatformAuditAccess(actor: AuthenticatedUser): Promise<void> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (!permissions.has('platform.audit.read')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cross-tenant audit access requires platform.audit.read',
      })
    }
  }
}
