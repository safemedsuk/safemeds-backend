import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { InspectionChecklistTemplate, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateInspectionChecklistTemplateDto } from './dto/create-inspection-checklist-template.dto'
import { UpdateInspectionChecklistTemplateDto } from './dto/update-inspection-checklist-template.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * QualCloud (Phase 13) Stage 9 — the platform-admin half of the
 * checklist template, mirroring `RequirementDefinitionAdminService`
 * (VigiCloud Stage 16.2's own real precedent for exactly this class of
 * problem — a seed-file-transcribed, per-authority checklist that
 * needs to become admin-editable without a redeploy) — same plain
 * `PrismaService` (no RLS; this is platform-wide reference data, not
 * tenant data), same deliberately narrow update surface.
 */
@Injectable()
export class InspectionChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(authorityId?: string): Promise<InspectionChecklistTemplate[]> {
    return this.prisma.inspectionChecklistTemplate.findMany({
      where: authorityId ? { authorityId } : undefined,
      orderBy: [{ authorityId: 'asc' }, { sortOrder: 'asc' }],
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateInspectionChecklistTemplateDto,
    meta: RequestMeta,
  ): Promise<InspectionChecklistTemplate> {
    let created: InspectionChecklistTemplate
    try {
      created = await this.prisma.inspectionChecklistTemplate.create({
        data: {
          id: newId(),
          authorityId: dto.authorityId,
          sectionKey: dto.sectionKey,
          title: dto.title,
          description: dto.description,
          mappedRecordType: dto.mappedRecordType,
          guidelineReference: dto.guidelineReference,
          sortOrder: dto.sortOrder ?? 0,
          unverified: dto.unverified ?? true,
          active: true,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'SECTION_ALREADY_EXISTS',
          message: `A checklist section with key "${dto.sectionKey}" already exists for this authority`,
        })
      }
      throw err
    }

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'inspection_checklist_template_created',
      recordType: 'inspection_checklist_template',
      recordId: created.id,
      newValue: { authorityId: dto.authorityId, sectionKey: dto.sectionKey, title: dto.title },
      ip: meta.ip,
    })

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateInspectionChecklistTemplateDto,
    meta: RequestMeta,
  ): Promise<InspectionChecklistTemplate> {
    const existing = await this.prisma.inspectionChecklistTemplate.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Checklist section not found' })
    }

    const updated = await this.prisma.inspectionChecklistTemplate.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description === '' ? null : dto.description,
        guidelineReference: dto.guidelineReference === '' ? null : dto.guidelineReference,
        sortOrder: dto.sortOrder,
        unverified: dto.unverified,
        active: dto.active,
      },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'inspection_checklist_template_updated',
      recordType: 'inspection_checklist_template',
      recordId: id,
      oldValue: existing,
      newValue: updated,
      ip: meta.ip,
    })

    return updated
  }
}
