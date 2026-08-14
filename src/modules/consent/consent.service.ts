import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConsentRecord, ConsentType } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CaptureConsentDto } from './dto/capture-consent.dto'
import { ListConsentQueryDto } from './dto/list-consent-query.dto'

export interface RequestMeta {
  ip?: string
}

export interface ConsentCheckResult {
  hasRecord: boolean
  /** `null` when no record exists at all — distinct from an explicit `false` (declined, or granted-then-withdrawn). */
  granted: boolean | null
  record: ConsentRecord | null
}

/**
 * VigiCloud Stage 0.1 — a generic, polymorphic consent primitive (base
 * engine, not PV-specific — QualCloud/RegCloud attach consent to their
 * own `recordType`s the same way once they exist). Every write is
 * audited in the same transaction it occurs in, per the platform-wide
 * `RlsService`/`AuditService` convention.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async capture(
    actor: AuthenticatedUser,
    dto: CaptureConsentDto,
    meta: RequestMeta,
  ): Promise<ConsentRecord> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const record = await tx.consentRecord.create({
        data: {
          id: newId(),
          companyId: actor.companyId!,
          recordType: dto.recordType,
          recordId: dto.recordId,
          consentType: dto.consentType,
          granted: dto.granted,
          method: dto.method,
          formVersion: dto.formVersion ?? 1,
          capturedBy: actor.sub,
          grantedAt: dto.granted ? new Date() : null,
        },
      })

      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'consent_captured',
        recordType: 'consent_record',
        recordId: record.id,
        newValue: {
          recordType: dto.recordType,
          recordId: dto.recordId,
          consentType: dto.consentType,
          granted: dto.granted,
          method: dto.method,
        },
        ip: meta.ip,
      })

      return record
    })
  }

  /**
   * VigiCloud Stage 3 — captures consent with no authenticated actor at
   * all, for a reporter consenting directly through an unauthenticated
   * channel (the public reporting form). `capturedBy` is stored `null` —
   * exactly the case the model's own doc comment already anticipated
   * ("null for a self-service capture... through a future public
   * reporting form"). Takes `companyId` directly rather than an `actor`,
   * since there's no `AuthenticatedUser` to derive it from.
   */
  async captureSystem(
    companyId: string,
    dto: CaptureConsentDto,
    meta: RequestMeta,
  ): Promise<ConsentRecord> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const record = await tx.consentRecord.create({
        data: {
          id: newId(),
          companyId,
          recordType: dto.recordType,
          recordId: dto.recordId,
          consentType: dto.consentType,
          granted: dto.granted,
          method: dto.method,
          formVersion: dto.formVersion ?? 1,
          capturedBy: null,
          grantedAt: dto.granted ? new Date() : null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'consent_captured',
        recordType: 'consent_record',
        recordId: record.id,
        newValue: {
          recordType: dto.recordType,
          recordId: dto.recordId,
          consentType: dto.consentType,
          granted: dto.granted,
          method: dto.method,
          capturedBy: 'self-service (unauthenticated channel)',
        },
        ip: meta.ip,
      })

      return record
    })
  }

  async withdraw(
    actor: AuthenticatedUser,
    consentRecordId: string,
    meta: RequestMeta,
  ): Promise<ConsentRecord> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const existing = await tx.consentRecord.findFirst({
        where: { id: consentRecordId, companyId: actor.companyId! },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Consent record not found' })
      }
      if (existing.withdrawnAt) {
        throw new ConflictException({
          code: 'ALREADY_WITHDRAWN',
          message: 'This consent has already been withdrawn',
        })
      }

      const updated = await tx.consentRecord.update({
        where: { id: consentRecordId },
        data: { withdrawnAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'consent_withdrawn',
        recordType: 'consent_record',
        recordId: existing.id,
        oldValue: { withdrawnAt: null },
        newValue: { withdrawnAt: updated.withdrawnAt?.toISOString() ?? null },
        ip: meta.ip,
      })

      return updated
    })
  }

  async check(
    actor: AuthenticatedUser,
    recordType: string,
    recordId: string,
    consentType: ConsentType,
  ): Promise<ConsentCheckResult> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const latest = await tx.consentRecord.findFirst({
        where: { companyId: actor.companyId!, recordType, recordId, consentType },
        orderBy: { createdAt: 'desc' },
      })

      if (!latest) {
        return { hasRecord: false, granted: null, record: null }
      }

      return { hasRecord: true, granted: latest.granted && !latest.withdrawnAt, record: latest }
    })
  }

  /**
   * VigiCloud Stage 11 — the periodic follow-up job checks consent with
   * no authenticated actor at all (a system-triggered scan, same reason
   * `captureSystem()` exists). `RlsService.runAsCompany()` transparently
   * reuses the caller's already-open transaction when one exists (see its
   * own doc comment), so calling this from inside `CaseFollowUpService`'s
   * own `runAsCompany` block is safe — no real nested transaction.
   */
  async checkSystem(
    companyId: string,
    recordType: string,
    recordId: string,
    consentType: ConsentType,
  ): Promise<ConsentCheckResult> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const latest = await tx.consentRecord.findFirst({
        where: { companyId, recordType, recordId, consentType },
        orderBy: { createdAt: 'desc' },
      })

      if (!latest) {
        return { hasRecord: false, granted: null, record: null }
      }

      return { hasRecord: true, granted: latest.granted && !latest.withdrawnAt, record: latest }
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListConsentQueryDto,
  ): Promise<PaginatedResult<ConsentRecord>> {
    this.assertTenantContext(actor)

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const where = {
        companyId: actor.companyId!,
        ...(query.recordType ? { recordType: query.recordType } : {}),
        ...(query.recordId ? { recordId: query.recordId } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.consentRecord.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.consentRecord.count({ where }),
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
