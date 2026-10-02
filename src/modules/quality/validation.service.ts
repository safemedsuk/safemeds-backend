import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, Sop, ValidationProtocol, ValidationReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateValidationProtocolDto } from './dto/create-validation-protocol.dto'
import { CreateValidationReportDto } from './dto/create-validation-report.dto'
import { FinalizeValidationReportDto } from './dto/finalize-validation-report.dto'
import { ListValidationProtocolsQueryDto } from './dto/list-validation-protocols-query.dto'
import { SopService } from './sop.service'

export interface RequestMeta {
  ip?: string
}

export const VALIDATION_PROTOCOL_RECORD_TYPE = 'validation_protocol'
export const VALIDATION_REPORT_RECORD_TYPE = 'validation_report'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Validation records are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

export type ValidationProtocolWithDocument = ValidationProtocol & { protocolDocument: Sop }

/**
 * QualCloud (Phase 13) Stage 18 — Validation (Process/Cleaning/Method)
 * and Computer System Validation. A validation protocol *is* a
 * controlled document — `create()` always creates its backing `Sop`
 * row first (via the existing `SopService.create()`, `documentType:
 * 'protocol'`) and the protocol's own approval lifecycle is read live
 * from that `Sop`'s own `status`/real `quality_controlled_document`
 * workflow — never a second, parallel approval mechanism. The report
 * half (`ValidationReport`) is a plain, separate record capturing
 * execution results/conclusion against an already-authored protocol —
 * not itself a controlled document.
 */
@Injectable()
export class ValidationService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly sopService: SopService,
  ) {}

  async listProtocols(
    actor: AuthenticatedUser,
    query: ListValidationProtocolsQueryDto,
  ): Promise<PaginatedResult<ValidationProtocolWithDocument>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ValidationProtocolWhereInput = {
        companyId,
        ...(query.validationType ? { validationType: query.validationType } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.validationProtocol.findMany({
          where,
          include: { protocolDocument: true },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.validationProtocol.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async getProtocol(actor: AuthenticatedUser, id: string): Promise<ValidationProtocolWithDocument> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.validationProtocol.findFirst({
        where: { id, companyId },
        include: { protocolDocument: true },
      })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Validation protocol not found' })
      return found
    })
  }

  async createProtocol(
    actor: AuthenticatedUser,
    dto: CreateValidationProtocolDto,
    meta: RequestMeta,
  ): Promise<ValidationProtocolWithDocument> {
    const companyId = requireCompany(actor)

    // The backing controlled document — its own call, its own
    // transaction, matching `ComplaintService`/`ChangeControlService`'s
    // own established "cross-service call stays sequential, never
    // nested" discipline.
    const sop = await this.sopService.create(
      actor,
      {
        documentNumber: dto.documentNumber,
        title: dto.title,
        documentType: 'protocol',
        productId: dto.productId,
      },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.validationProtocol.create({
        data: {
          id: newId(),
          companyId,
          title: dto.title,
          validationType: dto.validationType,
          approach: dto.validationType === 'process' ? dto.approach ?? null : null,
          gampCategory: dto.validationType === 'computer_system' ? dto.gampCategory ?? null : null,
          productId: dto.productId ?? null,
          equipmentId: dto.equipmentId ?? null,
          protocolDocumentId: sop.id,
          nextRevalidationDueAt: dto.nextRevalidationDueAt ? new Date(dto.nextRevalidationDueAt) : null,
          createdBy: actor.sub,
        },
        include: { protocolDocument: true },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'validation_protocol_created',
        recordType: VALIDATION_PROTOCOL_RECORD_TYPE,
        recordId: created.id,
        newValue: { validationType: created.validationType, protocolDocumentId: sop.id },
        ip: meta.ip,
      })

      return created
    })
  }

  async listReportsForProtocol(actor: AuthenticatedUser, protocolId: string): Promise<ValidationReport[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.validationReport.findMany({ where: { protocolId, companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async createReport(
    actor: AuthenticatedUser,
    protocolId: string,
    dto: CreateValidationReportDto,
    meta: RequestMeta,
  ): Promise<ValidationReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const protocol = await tx.validationProtocol.findFirst({
        where: { id: protocolId, companyId },
        include: { protocolDocument: true },
      })
      if (!protocol)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Validation protocol not found' })
      if (protocol.protocolDocument.status !== 'effective') {
        throw new ConflictException({
          code: 'PROTOCOL_NOT_EFFECTIVE',
          message: 'The validation protocol must be an effective controlled document before execution is recorded',
        })
      }
      if (dto.reportDocumentId) {
        const document = await tx.document.findFirst({ where: { id: dto.reportDocumentId, companyId } })
        if (!document)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report document not found' })
      }

      const created = await tx.validationReport.create({
        data: {
          id: newId(),
          companyId,
          protocolId,
          executionRecords: (dto.executionRecords ?? undefined) as Prisma.InputJsonValue | undefined,
          reportDocumentId: dto.reportDocumentId ?? null,
          conclusion: dto.conclusion ?? null,
          executedBy: actor.sub,
          executedAt: new Date(),
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'validation_report_created',
        recordType: VALIDATION_REPORT_RECORD_TYPE,
        recordId: created.id,
        newValue: { protocolId, conclusion: created.conclusion },
        ip: meta.ip,
      })

      return created
    })
  }

  async finalizeReport(
    actor: AuthenticatedUser,
    id: string,
    dto: FinalizeValidationReportDto,
    meta: RequestMeta,
  ): Promise<ValidationReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.validationReport.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Validation report not found' })

      const updated = await tx.validationReport.update({
        where: { id },
        data: { conclusion: dto.conclusion },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'validation_report_finalized',
        recordType: VALIDATION_REPORT_RECORD_TYPE,
        recordId: id,
        newValue: { conclusion: dto.conclusion },
        ip: meta.ip,
      })

      return updated
    })
  }
}
