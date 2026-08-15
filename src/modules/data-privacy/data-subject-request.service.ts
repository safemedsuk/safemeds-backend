import { ForbiddenException, Injectable } from '@nestjs/common'
import { DataSubjectRequest } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateDataSubjectRequestDto } from './dto/create-data-subject-request.dto'
import { ListDataSubjectRequestsQueryDto } from './dto/list-data-subject-requests-query.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * VigiCloud Stage 0.2 — Kenya-DPA/GDPR data-subject access (export) and
 * erasure requests. This is the auditable request ledger and the erasure
 * *blocking gate*, not a per-recordType data exporter/eraser — no
 * concrete personal-data table (a PV `Case`, a QualCloud deviation, ...)
 * exists in the schema yet (VigiCloud Stage 1+), so there is nothing
 * generic code could safely delete on a caller's say-so. What genuinely
 * exists today, and is real, is the base engine's `Deadline` table
 * (Phase 5) — already polymorphic on the same `recordType`/`recordId`
 * pair — so the erasure request can, right now, honestly answer "is
 * there an open regulatory obligation against this record" by checking
 * it directly, per the Tier 0 requirement: "a case under an open
 * reporting clock cannot be erased — the request is queued until the
 * clock closes."
 */
@Injectable()
export class DataSubjectRequestService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async request(
    actor: AuthenticatedUser,
    dto: CreateDataSubjectRequestDto,
    meta: RequestMeta,
  ): Promise<DataSubjectRequest> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const created = await tx.dataSubjectRequest.create({
        data: {
          id: newId(),
          companyId: actor.companyId!,
          recordType: dto.recordType,
          recordId: dto.recordId,
          requestType: dto.requestType,
          requestedBy: actor.sub,
        },
      })

      let result = created

      if (dto.requestType === 'erasure') {
        const openDeadline = await tx.deadline.findFirst({
          where: { recordType: dto.recordType, recordId: dto.recordId, status: 'pending' },
        })

        if (openDeadline) {
          result = await tx.dataSubjectRequest.update({
            where: { id: created.id },
            data: {
              status: 'blocked',
              blockedReason:
                'An open regulatory deadline exists for this record; erasure is queued until it closes.',
            },
          })
        } else {
          result = await tx.dataSubjectRequest.update({
            where: { id: created.id },
            data: { status: 'completed', completedAt: new Date() },
          })
        }
      } else {
        // Exports have no blocking concept — compiling the actual export
        // payload is per-recordType and lands once each concrete domain
        // table exists (Stage 1+); this ledger entry is the auditable
        // record that the request was made and granted.
        result = await tx.dataSubjectRequest.update({
          where: { id: created.id },
          data: { status: 'completed', completedAt: new Date() },
        })
      }

      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'data_subject_request_created',
        recordType: 'data_subject_request',
        recordId: result.id,
        newValue: {
          recordType: dto.recordType,
          recordId: dto.recordId,
          requestType: dto.requestType,
          status: result.status,
          blockedReason: result.blockedReason,
        },
        ip: meta.ip,
      })

      return result
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListDataSubjectRequestsQueryDto,
  ): Promise<PaginatedResult<DataSubjectRequest>> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const where = {
        companyId: actor.companyId!,
        ...(query.status ? { status: query.status } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.dataSubjectRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.dataSubjectRequest.count({ where }),
      ])

      return paginate(rows, total, query)
    })
  }

  private assertTenantContext(actor: AuthenticatedUser): void {
    if (!actor.companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No company context for this account',
      })
    }
  }
}
