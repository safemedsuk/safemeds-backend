import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { TrainingRecord } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { AttachTrainingCertificateDto } from './dto/attach-training-certificate.dto'
import { CreateTrainingRecordDto } from './dto/create-training-record.dto'
import { ListTrainingRecordsQueryDto } from './dto/list-training-records-query.dto'

export interface RequestMeta {
  ip?: string
}

export const TRAINING_RECORD_RECORD_TYPE = 'training_record'

export type TrainingRecordComputedStatus = 'valid' | 'expiring' | 'expired'

export interface TrainingRecordWithStatus extends TrainingRecord {
  computedStatus: TrainingRecordComputedStatus
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Training records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

const EXPIRY_WARNING_DAYS = 30

export function computeTrainingStatus(
  expiryDate: Date | null,
  now: Date = new Date(),
): TrainingRecordComputedStatus {
  if (!expiryDate) return 'valid'
  if (expiryDate < now) return 'expired'
  const warningCutoff = new Date(now)
  warningCutoff.setDate(warningCutoff.getDate() + EXPIRY_WARNING_DAYS)
  if (expiryDate < warningCutoff) return 'expiring'
  return 'valid'
}

/**
 * VigiCloud Stage 16.6 — a per-staff-member training log. `computedStatus`
 * (valid/expiring/expired) is never stored — see `TrainingRecord`'s own
 * schema doc comment for why it's cheaply derived at read time instead.
 */
@Injectable()
export class TrainingRecordService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateTrainingRecordDto,
    meta: RequestMeta,
  ): Promise<TrainingRecord> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: dto.userId, companyId } })
      if (!user) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'User not found in this company',
        })
      }

      const created = await tx.trainingRecord.create({
        data: {
          id: newId(),
          companyId,
          userId: dto.userId,
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
        action: 'training_record_logged',
        recordType: TRAINING_RECORD_RECORD_TYPE,
        recordId: created.id,
        newValue: { userId: dto.userId, trainingType: dto.trainingType, title: dto.title },
        ip: meta.ip,
      })

      return created
    })
  }

  async attachCertificate(
    actor: AuthenticatedUser,
    id: string,
    dto: AttachTrainingCertificateDto,
    meta: RequestMeta,
  ): Promise<TrainingRecord> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.trainingRecord.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Training record not found' })
      }
      const document = await tx.document.findFirst({
        where: {
          id: dto.documentId,
          companyId,
          recordType: TRAINING_RECORD_RECORD_TYPE,
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

      const updated = await tx.trainingRecord.update({
        where: { id },
        data: { certificateDocumentId: dto.documentId },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'training_certificate_attached',
        recordType: TRAINING_RECORD_RECORD_TYPE,
        recordId: id,
        newValue: { documentId: dto.documentId },
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListTrainingRecordsQueryDto,
  ): Promise<PaginatedResult<TrainingRecordWithStatus>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const q = query.q?.trim()
      const where = q
        ? {
            companyId,
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { trainingType: { contains: q, mode: 'insensitive' as const } },
              { user: { fullName: { contains: q, mode: 'insensitive' as const } } },
              { user: { email: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : { companyId }
      const [rows, total] = await Promise.all([
        tx.trainingRecord.findMany({
          where,
          orderBy: { completionDate: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.trainingRecord.count({ where }),
      ])
      return paginate(
        rows.map((r) => ({ ...r, computedStatus: computeTrainingStatus(r.expiryDate) })),
        total,
        query,
      )
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<TrainingRecordWithStatus> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.trainingRecord.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Training record not found' })
      }
      return { ...found, computedStatus: computeTrainingStatus(found.expiryDate) }
    })
  }
}
