import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RecallQuarantineRecord, RecallReturnRecord } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateRecallQuarantineRecordDto } from './dto/create-recall-quarantine-record.dto'
import { CreateRecallReturnRecordDto } from './dto/create-recall-return-record.dto'
import { VerifyRecallReturnRecordDto } from './dto/verify-recall-return-record.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Quarantine/return records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

async function nextReturnRef(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
  const count = await tx.recallReturnRecord.count({
    where: { companyId, ref: { startsWith: `RET-${year}-` } },
  })
  return `RET-${year}-${String(count + 1).padStart(4, '0')}`
}

/**
 * QualCloud (Phase 13) Stage 10.5 — real part-pack counting
 * (`RecallQuarantineRecord.partPacks`, not whole-packs-only) and the
 * genuine `genuine | suspect | mismatched_batch | expired` verdict on a
 * physical return — **only a `genuine` verdict ever counts as
 * recovered stock** in `RecallReconciliationService`'s own read of
 * these rows; `suspect` holds the return rather than silently
 * crediting it (no `FalsifiedProductReport` table exists yet to link
 * to — `verdictNote` carries the reasoning honestly until one does, per
 * this model's own schema doc comment).
 */
@Injectable()
export class RecallQuarantineService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async listQuarantine(actor: AuthenticatedUser, recallId: string): Promise<RecallQuarantineRecord[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallQuarantineRecord.findMany({
        where: { companyId, recallId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async recordQuarantine(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallQuarantineRecordDto,
    meta: RequestMeta,
  ): Promise<RecallQuarantineRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const created = await tx.recallQuarantineRecord.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          stakeholderId: dto.stakeholderId ?? null,
          batchId: dto.batchId,
          fullPacks: dto.fullPacks ?? 0,
          partPacks: dto.partPacks
            ? (dto.partPacks as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          evidenceDocumentIds: dto.evidenceDocumentIds ?? [],
          recordedBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_quarantine_recorded',
        recordType: 'recall_quarantine_record',
        recordId: created.id,
        newValue: { batchId: dto.batchId, fullPacks: created.fullPacks },
        ip: meta.ip,
      })
      return created
    })
  }

  async listReturns(actor: AuthenticatedUser, recallId: string): Promise<RecallReturnRecord[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallReturnRecord.findMany({ where: { companyId, recallId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async createReturn(
    actor: AuthenticatedUser,
    recallId: string,
    dto: CreateRecallReturnRecordDto,
    meta: RequestMeta,
  ): Promise<RecallReturnRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const recall = await tx.recall.findFirst({ where: { id: recallId, companyId } })
      if (!recall) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall not found' })

      const ref = await nextReturnRef(tx, companyId)
      const created = await tx.recallReturnRecord.create({
        data: {
          id: newId(),
          companyId,
          recallId,
          ref,
          fromOrgId: dto.fromOrgId ?? null,
          batchScannedGtin: dto.batchScannedGtin ?? null,
          batchScannedLot: dto.batchScannedLot ?? null,
          batchScannedExpiry: dto.batchScannedExpiry ? new Date(dto.batchScannedExpiry) : null,
          batchScannedSerial: dto.batchScannedSerial ?? null,
          batchId: dto.batchId ?? null,
          qty: dto.qty,
          creditStatus: 'pending',
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_return_created',
        recordType: 'recall_return_record',
        recordId: created.id,
        newValue: { ref, qty: dto.qty },
        ip: meta.ip,
      })
      return created
    })
  }

  async verifyReturn(
    actor: AuthenticatedUser,
    returnId: string,
    dto: VerifyRecallReturnRecordDto,
    meta: RequestMeta,
  ): Promise<RecallReturnRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallReturnRecord.findFirst({ where: { id: returnId, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Return not found' })

      const updated = await tx.recallReturnRecord.update({
        where: { id: returnId },
        data: {
          verdict: dto.verdict,
          verdictNote: dto.verdictNote ?? null,
          // Only a genuine verdict ever gets credited — everything
          // else stays pending/disputed rather than silently crediting.
          creditStatus: dto.verdict === 'genuine' ? 'approved' : 'disputed',
          verifiedBy: actor.sub,
          verifiedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_return_verified',
        recordType: 'recall_return_record',
        recordId: returnId,
        newValue: { verdict: dto.verdict, creditStatus: updated.creditStatus },
        ip: meta.ip,
      })
      return updated
    })
  }
}
