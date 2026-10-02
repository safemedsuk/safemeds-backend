import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { InternalAuditChecklistResponse } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { UpdateChecklistResponseDto } from './dto/update-checklist-response.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Internal audits are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 9 — the conduct-mode checklist: "check off
 * each real inspection item live against the template, attach
 * observations" (`todo-qualcloud.md`'s own FE bullet). `startConduct()`
 * instantiates one response row per active `InspectionChecklistTemplate`
 * section for the company's own home-country authority — the exact
 * same `authority: { countryId: company.homeCountryId }` resolution
 * `AuditReadinessService.getDashboard()` already established — upserted
 * on `(auditId, checklistTemplateId)`, safe to call again on an
 * already-started audit if a new section was added since.
 */
@Injectable()
export class InternalAuditChecklistService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async startConduct(
    actor: AuthenticatedUser,
    auditId: string,
    meta: RequestMeta,
  ): Promise<InternalAuditChecklistResponse[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const audit = await tx.internalAudit.findFirst({ where: { id: auditId, companyId } })
      if (!audit) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Internal audit not found' })
      }

      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { homeCountryId: true },
      })
      const templates = await tx.inspectionChecklistTemplate.findMany({
        where: { active: true, authority: { countryId: company.homeCountryId } },
        orderBy: { sortOrder: 'asc' },
      })

      const responses: InternalAuditChecklistResponse[] = []
      for (const template of templates) {
        const response = await tx.internalAuditChecklistResponse.upsert({
          where: {
            auditId_checklistTemplateId: { auditId, checklistTemplateId: template.id },
          },
          create: {
            id: newId(),
            companyId,
            auditId,
            checklistTemplateId: template.id,
          },
          update: {},
        })
        responses.push(response)
      }

      if (audit.status === 'scheduled') {
        await tx.internalAudit.update({ where: { id: auditId }, data: { status: 'in_progress' } })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'internal_audit_conduct_started',
        recordType: 'internal_audit',
        recordId: auditId,
        newValue: { checklistItemCount: responses.length },
        ip: meta.ip,
      })

      return responses
    })
  }

  async list(
    actor: AuthenticatedUser,
    auditId: string,
  ): Promise<(InternalAuditChecklistResponse & { checklistTemplate: { title: string; description: string | null; sortOrder: number } })[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.internalAuditChecklistResponse.findMany({
        where: { companyId, auditId },
        include: {
          checklistTemplate: { select: { title: true, description: true, sortOrder: true } },
        },
        orderBy: { checklistTemplate: { sortOrder: 'asc' } },
      }),
    )
  }

  async respond(
    actor: AuthenticatedUser,
    responseId: string,
    dto: UpdateChecklistResponseDto,
    meta: RequestMeta,
  ): Promise<InternalAuditChecklistResponse> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.internalAuditChecklistResponse.findFirst({
        where: { id: responseId, companyId },
      })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Checklist response not found' })
      }

      const updated = await tx.internalAuditChecklistResponse.update({
        where: { id: responseId },
        data: {
          status: dto.status,
          observations: dto.observations ?? existing.observations,
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'internal_audit_checklist_response_recorded',
        recordType: 'internal_audit_checklist_response',
        recordId: responseId,
        newValue: { status: dto.status },
        ip: meta.ip,
      })

      return updated
    })
  }
}
