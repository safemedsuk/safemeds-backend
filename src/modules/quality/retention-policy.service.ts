import { ForbiddenException, Injectable } from '@nestjs/common'
import { RetentionPolicy } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, PaginationQueryDto } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { UpsertRetentionPolicyDto } from './dto/upsert-retention-policy.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * QualCloud (Phase 13) Stage 0.2 — ALCOA+'s "Enduring/Available" made
 * concrete. `todo-qualcloud.md`'s own 🧭 domain defaults, documented here
 * (not hardcoded as unchangeable — a company that hasn't set its own row
 * for a `recordType` simply gets this value back from `getDefault()`,
 * and setting a real row via `upsert()` always wins). `training_record`
 * is deliberately absent from this map — its real-world default
 * ("for the duration of employment plus 3 years") isn't a flat year
 * count and can't be represented until a future stage models employment
 * duration directly; `getDefault()` returns `null` for it rather than a
 * fabricated number.
 */
export const RETENTION_POLICY_DEFAULT_YEARS: Record<string, number> = {
  controlled_document: 10,
  master_batch_record: 10,
  deviation: 5,
  capa: 5,
  complaint: 5,
  oos_oot: 5,
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Retention policies are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  getDefault(recordType: string): number | null {
    return RETENTION_POLICY_DEFAULT_YEARS[recordType] ?? null
  }

  async list(
    actor: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<RetentionPolicy>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.retentionPolicy.findMany({
          where,
          orderBy: { recordType: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.retentionPolicy.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  /**
   * Create-or-update in place by the `(companyId, recordType)` natural
   * key — a settings row, not a regulatory record, so it is deliberately
   * NOT version-on-write (no audit-trailed history the way a
   * `ReportingRule` needs) — every change is still fully captured by
   * `AuditService`'s own append-only trail below.
   */
  async upsert(
    actor: AuthenticatedUser,
    dto: UpsertRetentionPolicyDto,
    meta: RequestMeta,
  ): Promise<RetentionPolicy> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.retentionPolicy.findFirst({
        where: { companyId, recordType: dto.recordType },
      })

      const saved = existing
        ? await tx.retentionPolicy.update({
            where: { id: existing.id },
            data: { retentionYears: dto.retentionYears },
          })
        : await tx.retentionPolicy.create({
            data: {
              id: newId(),
              companyId,
              recordType: dto.recordType,
              retentionYears: dto.retentionYears,
            },
          })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: existing ? 'retention_policy_updated' : 'retention_policy_created',
        recordType: 'retention_policy',
        recordId: saved.id,
        oldValue: existing ? { retentionYears: existing.retentionYears } : undefined,
        newValue: { recordType: dto.recordType, retentionYears: dto.retentionYears },
        ip: meta.ip,
      })
      return saved
    })
  }
}
