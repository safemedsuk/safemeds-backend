import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditRequirementDefinition, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { CreateRequirementDefinitionDto } from './dto/create-requirement-definition.dto'
import { UpdateRequirementDefinitionDto } from './dto/update-requirement-definition.dto'

export interface RequestMeta {
  ip?: string
}

/**
 * Admin Configuration Console — Gap 3. The 15-row PPB inspection
 * catalog (`prisma/audit-requirements.seed-data.ts`) was originally
 * transcribed from the CEO/field-expert call's own planning-summary
 * PDF, not a per-item, guideline-cited definitive checklist — this
 * service is how a field expert's real citations (and any genuinely
 * new `person_uploads`-sourced requirement they identify) get into the
 * live system without a seed-file edit and redeploy.
 *
 * Deliberately narrow: this NEVER touches `source` or the live
 * ready/missing computation — `AuditReadinessService`'s own per-
 * `requirementKey` resolver map is what actually decides a
 * `system_generated` row's status, reading real data from six other
 * stages, and that stays code. What's editable here is purely
 * descriptive: title, description, guideline reference, evidence type,
 * mandatory flag, sort order, and active/inactive — see each DTO's own
 * doc comment for the full reasoning.
 */
@Injectable()
export class RequirementDefinitionAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(authorityId?: string): Promise<AuditRequirementDefinition[]> {
    return this.prisma.auditRequirementDefinition.findMany({
      where: authorityId ? { authorityId } : undefined,
      orderBy: [{ authorityId: 'asc' }, { sortOrder: 'asc' }],
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRequirementDefinitionDto,
    meta: RequestMeta,
  ): Promise<AuditRequirementDefinition> {
    let created: AuditRequirementDefinition
    try {
      created = await this.prisma.auditRequirementDefinition.create({
        data: {
          id: newId(),
          authorityId: dto.authorityId,
          requirementKey: dto.requirementKey,
          sortOrder: dto.sortOrder,
          title: dto.title,
          description: dto.description,
          guidelineReference: dto.guidelineReference,
          source: dto.source,
          evidenceArtifactType: dto.evidenceArtifactType,
          isMandatory: dto.isMandatory ?? true,
          active: true,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'REQUIREMENT_ALREADY_EXISTS',
          message: `A requirement with key "${dto.requirementKey}" already exists for this authority`,
        })
      }
      throw err
    }

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'audit_requirement_definition_created',
      recordType: 'audit_requirement_definition',
      recordId: created.id,
      newValue: {
        authorityId: dto.authorityId,
        requirementKey: dto.requirementKey,
        title: dto.title,
        source: dto.source,
      },
      ip: meta.ip,
    })

    return created
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRequirementDefinitionDto,
    meta: RequestMeta,
  ): Promise<AuditRequirementDefinition> {
    const existing = await this.prisma.auditRequirementDefinition.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Requirement definition not found',
      })
    }

    const updated = await this.prisma.auditRequirementDefinition.update({
      where: { id },
      data: {
        sortOrder: dto.sortOrder,
        title: dto.title,
        description: dto.description,
        guidelineReference: dto.guidelineReference === '' ? null : dto.guidelineReference,
        evidenceArtifactType: dto.evidenceArtifactType,
        isMandatory: dto.isMandatory,
        active: dto.active,
      },
    })

    await this.auditService.log(this.prisma, {
      actorUserId: actor.sub,
      action: 'audit_requirement_definition_updated',
      recordType: 'audit_requirement_definition',
      recordId: id,
      oldValue: existing,
      newValue: updated,
      ip: meta.ip,
    })

    return updated
  }
}
