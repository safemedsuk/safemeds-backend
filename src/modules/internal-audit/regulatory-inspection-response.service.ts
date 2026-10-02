import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RegulatoryInspectionResponse } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { CreateRegulatoryInspectionResponseDto } from './dto/create-regulatory-inspection-response.dto'

export interface RequestMeta {
  ip?: string
}

const REGULATORY_INSPECTION_RESPONSE_RECORD_TYPE = 'regulatory_inspection_response'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Regulatory inspection responses are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 9 — the `regulatory`-scope audit's own
 * "prepare, host, respond" half: PPB (or another authority) raises a
 * finding while inspecting us, and this is the company's own tracked
 * response, with its own deadline and evidence pack.
 */
@Injectable()
export class RegulatoryInspectionResponseService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    auditId: string,
    dto: CreateRegulatoryInspectionResponseDto,
    meta: RequestMeta,
  ): Promise<RegulatoryInspectionResponse> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const audit = await tx.internalAudit.findFirst({ where: { id: auditId, companyId } })
      if (!audit) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Internal audit not found' })
      }
      if (audit.auditScope !== 'regulatory') {
        throw new BadRequestException({
          code: 'NOT_REGULATORY_SCOPE',
          message: 'Regulatory inspection responses only apply to a regulatory-scope audit.',
        })
      }

      const created = await tx.regulatoryInspectionResponse.create({
        data: {
          id: newId(),
          companyId,
          auditId,
          findingId: dto.findingId ?? null,
          responseDueDate: dto.responseDueDate ? new Date(dto.responseDueDate) : null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'regulatory_inspection_response_opened',
        recordType: REGULATORY_INSPECTION_RESPONSE_RECORD_TYPE,
        recordId: created.id,
        newValue: { auditId, findingId: dto.findingId ?? null },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(actor: AuthenticatedUser, auditId: string): Promise<RegulatoryInspectionResponse[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.regulatoryInspectionResponse.findMany({
        where: { companyId, auditId },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async submit(
    actor: AuthenticatedUser,
    id: string,
    responseText: string,
    file: DirectUploadFile | null,
    meta: RequestMeta,
  ): Promise<RegulatoryInspectionResponse> {
    const companyId = requireCompany(actor)

    let evidenceDocumentId: string | undefined
    if (file) {
      const upload = await this.documentsService.uploadDirect(
        actor,
        REGULATORY_INSPECTION_RESPONSE_RECORD_TYPE,
        id,
        file,
        { title: 'Regulatory Inspection Response Evidence' },
        meta,
      )
      evidenceDocumentId = upload.document.id
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.regulatoryInspectionResponse.findFirst({
        where: { id, companyId },
      })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Regulatory inspection response not found',
        })
      }

      const updated = await tx.regulatoryInspectionResponse.update({
        where: { id },
        data: {
          responseText,
          evidenceDocumentId: evidenceDocumentId ?? existing.evidenceDocumentId,
          submittedAt: new Date(),
          submittedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'regulatory_inspection_response_submitted',
        recordType: REGULATORY_INSPECTION_RESPONSE_RECORD_TYPE,
        recordId: id,
        newValue: { evidenceDocumentId: evidenceDocumentId ?? null },
        ip: meta.ip,
      })

      return updated
    })
  }
}
