import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, WasteDisposalRecord } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { SignatureService } from '../signatures/signature.service'
import { CreateWasteDisposalRecordDto } from './dto/create-waste-disposal-record.dto'
import { ListWasteDisposalRecordsQueryDto } from './dto/list-waste-disposal-records-query.dto'
import { WitnessWasteDisposalDto } from './dto/witness-waste-disposal.dto'

export interface RequestMeta {
  ip?: string
}

export const WASTE_DISPOSAL_RECORD_TYPE = 'waste_disposal_record'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Waste disposal records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 15 — Pharmaceutical Waste Management.
 * Genuinely, honestly unsourced — no real PPB waste-disposal procedure
 * document exists anywhere in this project's reference material — this
 * is deliberately built as a generic, jurisdiction-agnostic mechanism,
 * matching `todo-qualcloud.md`'s own 🧭 default. `recordWitness()`
 * reuses `SignatureService` directly, the same pattern
 * `BatchRecordReviewService.recordDisposition()`/`RecallDestructionService`
 * already use for a single-shot signed action — not every disposal
 * method needs a witness, so this is a distinct, optional second step
 * rather than part of `create()` itself.
 */
@Injectable()
export class WasteDisposalService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly signatureService: SignatureService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListWasteDisposalRecordsQueryDto,
  ): Promise<PaginatedResult<WasteDisposalRecord>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.WasteDisposalRecordWhereInput = {
        companyId,
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.wasteDisposalRecord.findMany({
          where,
          orderBy: { disposedAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.wasteDisposalRecord.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<WasteDisposalRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.wasteDisposalRecord.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waste disposal record not found' })
      return found
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateWasteDisposalRecordDto,
    meta: RequestMeta,
  ): Promise<WasteDisposalRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.batchId) {
        const batch = await tx.batch.findFirst({ where: { id: dto.batchId, companyId } })
        if (!batch) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })
      }
      if (dto.disposalCertificateDocumentId) {
        const document = await tx.document.findFirst({
          where: { id: dto.disposalCertificateDocumentId, companyId },
        })
        if (!document)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Disposal certificate document not found' })
      }

      const created = await tx.wasteDisposalRecord.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId ?? null,
          batchId: dto.batchId ?? null,
          wasteType: dto.wasteType,
          quantity: dto.quantity,
          unit: dto.unit,
          disposalMethod: dto.disposalMethod,
          disposalFacilityName: dto.disposalFacilityName ?? null,
          disposalCertificateDocumentId: dto.disposalCertificateDocumentId ?? null,
          disposedAt: new Date(dto.disposedAt),
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_record_created',
        recordType: WASTE_DISPOSAL_RECORD_TYPE,
        recordId: created.id,
        newValue: { wasteType: created.wasteType, disposalMethod: created.disposalMethod },
        ip: meta.ip,
      })

      return created
    })
  }

  /** A second person signs as destruction witness — optional, since not every disposal method needs one. */
  async recordWitness(
    actor: AuthenticatedUser,
    id: string,
    dto: WitnessWasteDisposalDto,
    meta: RequestMeta,
  ): Promise<WasteDisposalRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.wasteDisposalRecord.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Waste disposal record not found' })
      if (existing.witnessedByUserId) {
        throw new ConflictException({
          code: 'ALREADY_WITNESSED',
          message: 'This disposal has already been witnessed',
        })
      }

      const signature = await this.signatureService.sign(
        tx,
        actor,
        {
          recordType: WASTE_DISPOSAL_RECORD_TYPE,
          recordId: id,
          intentStatement: dto.intentStatement,
          signatureToken: dto.signatureToken,
          roleAtSigning: actor.roleKeys[0] ?? 'unknown',
          canonicalPayload: { wasteDisposalRecordId: id, witnessedBy: actor.sub },
        },
        meta,
      )

      const updated = await tx.wasteDisposalRecord.update({
        where: { id },
        data: {
          witnessedByUserId: actor.sub,
          witnessSignatureEventId: signature.id,
          witnessedAt: new Date(),
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'waste_disposal_record_witnessed',
        recordType: WASTE_DISPOSAL_RECORD_TYPE,
        recordId: id,
        newValue: {},
        ip: meta.ip,
      })

      return updated
    })
  }
}
