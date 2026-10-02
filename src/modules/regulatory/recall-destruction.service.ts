import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RecallDestructionRecord, RecallEffectivenessCheck } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CompleteRecallDestructionDto } from './dto/complete-recall-destruction.dto'
import { CreateRecallDestructionRecordDto } from './dto/create-recall-destruction-record.dto'
import { CreateRecallEffectivenessCheckDto } from './dto/create-recall-effectiveness-check.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Destruction/effectiveness records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 10.5 — `RecallDestructionRecord`
 * (destruction is **blocked** until disposal-approval evidence exists —
 * Tanzania's own confirmed regulation requires exactly this; a
 * standalone model since no `WasteDisposalRecord` exists yet in this
 * schema to reuse) and `RecallEffectivenessCheck` (real, per-check,
 * sampled evidence — a check with `stockFound > 0` stays open until
 * its own follow-up tasks close, never auto-resolved).
 */
@Injectable()
export class RecallDestructionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async listDestructionRecords(
    actor: AuthenticatedUser,
    recallCountryId: string,
  ): Promise<RecallDestructionRecord[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallDestructionRecord.findMany({
        where: { companyId, recallCountryId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async createDestructionRecord(
    actor: AuthenticatedUser,
    recallCountryId: string,
    dto: CreateRecallDestructionRecordDto,
    meta: RequestMeta,
  ): Promise<RecallDestructionRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.recallCountry.findFirst({ where: { id: recallCountryId, companyId } })
      if (!country) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })

      const created = await tx.recallDestructionRecord.create({
        data: {
          id: newId(),
          companyId,
          recallCountryId,
          units: dto.units,
          disposalApprovalEvidenceId: dto.disposalApprovalEvidenceId ?? null,
          status: dto.disposalApprovalEvidenceId ? 'approved' : 'pending_approval',
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_destruction_record_created',
        recordType: 'recall_destruction_record',
        recordId: created.id,
        newValue: { units: dto.units, status: created.status },
        ip: meta.ip,
      })
      return created
    })
  }

  async attachDisposalApproval(
    actor: AuthenticatedUser,
    destructionId: string,
    disposalApprovalEvidenceId: string,
    meta: RequestMeta,
  ): Promise<RecallDestructionRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallDestructionRecord.findFirst({
        where: { id: destructionId, companyId },
      })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Destruction record not found' })

      const updated = await tx.recallDestructionRecord.update({
        where: { id: destructionId },
        data: { disposalApprovalEvidenceId, status: 'approved' },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_destruction_disposal_approved',
        recordType: 'recall_destruction_record',
        recordId: destructionId,
        ip: meta.ip,
      })
      return updated
    })
  }

  /** Blocked until disposal-approval evidence exists — the real, named country requirement, made structural. */
  async markDestroyed(
    actor: AuthenticatedUser,
    destructionId: string,
    meta: RequestMeta,
  ): Promise<RecallDestructionRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallDestructionRecord.findFirst({
        where: { id: destructionId, companyId },
      })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Destruction record not found' })
      if (!existing.disposalApprovalEvidenceId) {
        throw new ConflictException({
          code: 'DISPOSAL_APPROVAL_REQUIRED',
          message: 'Destruction cannot proceed without disposal-approval evidence on record',
        })
      }

      const updated = await tx.recallDestructionRecord.update({
        where: { id: destructionId },
        data: { status: 'destroyed', destroyedBy: actor.sub, destroyedAt: new Date() },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_destruction_marked_destroyed',
        recordType: 'recall_destruction_record',
        recordId: destructionId,
        ip: meta.ip,
      })
      return updated
    })
  }

  async completeDestruction(
    actor: AuthenticatedUser,
    destructionId: string,
    dto: CompleteRecallDestructionDto,
    meta: RequestMeta,
  ): Promise<RecallDestructionRecord> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallDestructionRecord.findFirst({
        where: { id: destructionId, companyId },
      })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Destruction record not found' })
      if (existing.status !== 'destroyed') {
        throw new ConflictException({
          code: 'NOT_YET_DESTROYED',
          message: 'A destruction certificate can only be attached after destruction is marked complete',
        })
      }

      const updated = await tx.recallDestructionRecord.update({
        where: { id: destructionId },
        data: { certificateEvidenceId: dto.certificateEvidenceId, status: 'completed' },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_destruction_certificate_attached',
        recordType: 'recall_destruction_record',
        recordId: destructionId,
        ip: meta.ip,
      })
      return updated
    })
  }

  async listEffectivenessChecks(
    actor: AuthenticatedUser,
    recallCountryId: string,
  ): Promise<RecallEffectivenessCheck[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.recallEffectivenessCheck.findMany({
        where: { companyId, recallCountryId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async createEffectivenessCheck(
    actor: AuthenticatedUser,
    recallCountryId: string,
    dto: CreateRecallEffectivenessCheckDto,
    meta: RequestMeta,
  ): Promise<RecallEffectivenessCheck> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.recallCountry.findFirst({ where: { id: recallCountryId, companyId } })
      if (!country) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Recall country not found' })

      const created = await tx.recallEffectivenessCheck.create({
        data: {
          id: newId(),
          companyId,
          recallCountryId,
          method: dto.method,
          sampleSize: dto.sampleSize,
          clear: dto.clear,
          stockFound: dto.stockFound,
          followUpTaskIds: dto.followUpTaskIds ?? [],
          // A check with stock found stays open until its own
          // follow-up tasks close — never auto-resolved.
          status: dto.stockFound > 0 ? 'open' : 'closed',
          performedBy: actor.sub,
          performedAt: new Date(),
        },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_effectiveness_check_created',
        recordType: 'recall_effectiveness_check',
        recordId: created.id,
        newValue: { sampleSize: dto.sampleSize, clear: dto.clear, stockFound: dto.stockFound },
        ip: meta.ip,
      })
      return created
    })
  }

  async closeEffectivenessCheck(
    actor: AuthenticatedUser,
    checkId: string,
    meta: RequestMeta,
  ): Promise<RecallEffectivenessCheck> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.recallEffectivenessCheck.findFirst({ where: { id: checkId, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Effectiveness check not found' })

      const updated = await tx.recallEffectivenessCheck.update({
        where: { id: checkId },
        data: { status: 'closed' },
      })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'recall_effectiveness_check_closed',
        recordType: 'recall_effectiveness_check',
        recordId: checkId,
        ip: meta.ip,
      })
      return updated
    })
  }
}
