import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DistributorTrainingRecord } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AttachDistributorTrainingCertificateDto } from './dto/attach-distributor-training-certificate.dto'
import { CreateDistributorTrainingRecordDto } from './dto/create-distributor-training-record.dto'
import { ListDistributorTrainingRecordsQueryDto } from './dto/list-distributor-training-records-query.dto'

export interface RequestMeta {
  ip?: string
}

export const DISTRIBUTOR_TRAINING_RECORD_RECORD_TYPE = 'distributor_training_record'

export type DistributorTrainingStatus = 'valid' | 'expiring' | 'expired' | 'missing'
const EXPIRY_WARNING_DAYS = 30

export interface DistributorTrainingRecordWithStatus extends DistributorTrainingRecord {
  computedStatus: Exclude<DistributorTrainingStatus, 'missing'>
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Distributor training records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/** Mirrors `computeTrainingStatus()` (`TrainingRecordService`) exactly — same 30-day warning window, same "no expiry = always valid" rule. */
export function computeDistributorTrainingStatus(
  expiryDate: Date | null,
  now: Date = new Date(),
): Exclude<DistributorTrainingStatus, 'missing'> {
  if (!expiryDate) return 'valid'
  if (expiryDate < now) return 'expired'
  const warningCutoff = new Date(now)
  warningCutoff.setDate(warningCutoff.getDate() + EXPIRY_WARNING_DAYS)
  if (expiryDate < warningCutoff) return 'expiring'
  return 'valid'
}

/**
 * Real-usage request, 22 Sep 2026 (item 6) — "SDEA has reconciliation
 * and training — proof distributors are actually trained annually;
 * should essentially be a record checklist." A distributor-scoped
 * analog of `TrainingRecordService` (Stage 16.6) — same shape, same
 * "compute status live, never store it" discipline — with one
 * genuinely new read (`getStatusForDistributor()`), mirroring
 * `SdeaService.getStatusForDistributor()`'s exact "the real
 * reconciliation-at-risk flag" pattern: the Reconciliation screen's own
 * per-distributor row can show both "SDEA current?" and "training
 * current?" side by side.
 */
@Injectable()
export class DistributorTrainingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateDistributorTrainingRecordDto,
    meta: RequestMeta,
  ): Promise<DistributorTrainingRecord> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const distributor = await tx.distributor.findFirst({
        where: { id: dto.distributorId, companyId },
      })
      if (!distributor) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distributor not found' })
      }

      const created = await tx.distributorTrainingRecord.create({
        data: {
          id: newId(),
          companyId,
          distributorId: dto.distributorId,
          trainingType: dto.trainingType,
          title: dto.title,
          completionDate: new Date(dto.completionDate),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'distributor_training_record_logged',
        recordType: DISTRIBUTOR_TRAINING_RECORD_RECORD_TYPE,
        recordId: created.id,
        newValue: { distributorId: dto.distributorId, trainingType: dto.trainingType, title: dto.title },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachCertificate(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachDistributorTrainingCertificateDto,
    meta: RequestMeta,
  ): Promise<DistributorTrainingRecord> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.distributorTrainingRecord.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Distributor training record not found',
        })
      }
      const document = await tx.document.findFirst({
        where: {
          id: dto.documentId,
          companyId,
          recordType: DISTRIBUTOR_TRAINING_RECORD_RECORD_TYPE,
          recordId: id,
        },
      })
      if (!document) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message:
            'Certificate document not found for this training record — upload it first via the generic documents endpoint',
        })
      }

      const updated = await tx.distributorTrainingRecord.update({
        where: { id },
        data: { certificateDocumentId: dto.documentId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'distributor_training_certificate_attached',
        recordType: DISTRIBUTOR_TRAINING_RECORD_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListDistributorTrainingRecordsQueryDto,
  ): Promise<PaginatedResult<DistributorTrainingRecordWithStatus>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId, ...(query.distributorId ? { distributorId: query.distributorId } : {}) }
      const [rows, total] = await Promise.all([
        tx.distributorTrainingRecord.findMany({
          where,
          orderBy: { completionDate: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.distributorTrainingRecord.count({ where }),
      ])
      return paginate(
        rows.map((r) => ({ ...r, computedStatus: computeDistributorTrainingStatus(r.expiryDate) })),
        total,
        query,
      )
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<DistributorTrainingRecordWithStatus> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.distributorTrainingRecord.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Distributor training record not found',
        })
      }
      return { ...found, computedStatus: computeDistributorTrainingStatus(found.expiryDate) }
    })
  }

  /**
   * The real "proof distributors are actually trained annually" flag —
   * the most recent training record for this distributor, or `missing`
   * if none has ever been logged. Mirrors `SdeaService
   * .getStatusForDistributor()`'s exact shape, for the Reconciliation
   * screen to show both flags side by side per distributor.
   */
  async getStatusForDistributor(
    actor: AuthenticatedUser,
    distributorId: string,
  ): Promise<{ status: DistributorTrainingStatus; record: DistributorTrainingRecord | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const mostRecent = await tx.distributorTrainingRecord.findFirst({
        where: { companyId, distributorId },
        orderBy: { completionDate: 'desc' },
      })
      if (!mostRecent) return { status: 'missing' as const, record: null }
      return { status: computeDistributorTrainingStatus(mostRecent.expiryDate), record: mostRecent }
    })
  }
}
