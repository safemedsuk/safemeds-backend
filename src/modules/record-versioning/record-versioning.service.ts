import { ForbiddenException, Injectable } from '@nestjs/common'
import { Prisma, RecordVersion } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'

export interface RequestMeta {
  ip?: string
}

export interface CreateRecordVersionInput {
  recordType: string
  recordId: string
  snapshot: Record<string, unknown>
  reason?: string
}

/**
 * VigiCloud Stage 0.4 — a generic, cross-module version-history primitive.
 * Distinct from the `version Int` optimistic-concurrency column every
 * mutable table already carries (that's a lock counter for 409-on-conflict,
 * consumed by the client on every write); this is a queryable history of
 * *what the record actually looked like* at each captured point, designed
 * so PV `Case` (Stage 1), and later QualCloud/RegCloud records, all version
 * through the same table and the same audit trail rather than each
 * inventing its own.
 *
 * No live domain writes to this yet — deliberately internal-only
 * (`createVersion` is not exposed over HTTP), the same shape as
 * `AuditService.log()`: a future domain service computes its own
 * server-side snapshot and calls this directly, rather than a client
 * being trusted to POST an arbitrary JSON blob as "the record's new
 * version." Only the read side (`history`) is a real HTTP endpoint,
 * mirroring `AuditService`'s own `GET /records/:type/:id/history`.
 */
@Injectable()
export class RecordVersioningService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `actor.sub` is optional here — VigiCloud Stage 3's
   * `PvCaseService.createFromSystemChannel()` versions a case with no
   * logged-in human actor. `RecordVersion.capturedBy` was already
   * nullable for exactly this shape of caller. Every real caller already
   * passes a full `AuthenticatedUser`, which satisfies this narrower type
   * structurally — no existing call site needs to change.
   */
  async createVersion(
    actor: Pick<AuthenticatedUser, 'companyId'> & { sub?: string },
    input: CreateRecordVersionInput,
    meta: RequestMeta,
  ): Promise<RecordVersion> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const latest = await tx.recordVersion.findFirst({
        where: { recordType: input.recordType, recordId: input.recordId },
        orderBy: { versionNumber: 'desc' },
      })

      const versionNumber = (latest?.versionNumber ?? 0) + 1

      const created = await tx.recordVersion.create({
        data: {
          id: newId(),
          companyId: actor.companyId!,
          recordType: input.recordType,
          recordId: input.recordId,
          versionNumber,
          reason: input.reason ?? null,
          snapshot: input.snapshot as Prisma.InputJsonValue,
          previousVersionId: latest?.id ?? null,
          capturedBy: actor.sub ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        actorType: actor.sub ? 'user' : 'system',
        action: 'record_version_captured',
        recordType: 'record_version',
        recordId: created.id,
        newValue: {
          recordType: input.recordType,
          recordId: input.recordId,
          versionNumber,
          reason: input.reason,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async history(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
    pagination: { page: number; limit: number },
  ): Promise<PaginatedResult<RecordVersion>> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const where = { companyId: actor.companyId!, recordType, recordId }

      const [rows, total] = await Promise.all([
        tx.recordVersion.findMany({
          where,
          orderBy: { versionNumber: 'desc' },
          skip: (pagination.page - 1) * pagination.limit,
          take: pagination.limit,
        }),
        tx.recordVersion.count({ where }),
      ])

      return paginate(rows, total, pagination)
    })
  }

  private assertTenantContext(actor: Pick<AuthenticatedUser, 'companyId'>): void {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No company context for this account',
      })
    }
  }
}
