import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  CompetencyAssessment,
  Prisma,
  RoleTrainingCurriculum,
  Sop,
} from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateCompetencyAssessmentDto } from './dto/competency-assessment.dto'
import { CreateRoleTrainingCurriculumDto } from './dto/role-training-curriculum.dto'
import { computeTrainingStatus, TrainingRecordComputedStatus } from './training-record.service'

export interface RequestMeta {
  ip?: string
}

export const ROLE_TRAINING_CURRICULUM_RECORD_TYPE = 'role_training_curriculum'

export interface ComplianceStatusRow {
  curriculumId: string
  roleKey: string
  trainingTypeId: string
  trainingTypeLabel: string
  isMandatory: boolean
  status: TrainingRecordComputedStatus | 'missing'
  latestTrainingRecordId: string | null
  latestCompletionDate: Date | null
  latestExpiryDate: Date | null
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Training curricula are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 12 — Training & Competency Management.
 * `RoleTrainingCurriculum` is a plain, hard-deletable config mapping
 * (which training types are mandatory for which role, and how often)
 * — not a regulated evidentiary record the way a `TrainingRecord`
 * itself is, matching `ReportDefinition`'s own "a saved search/view,
 * not a regulated artifact" precedent for why this one doesn't follow
 * the schema's usual never-delete discipline. `getComplianceStatus()`
 * cross-references a user's live `roleKeys` against this table at read
 * time, computed fresh every call — never cached/stored, matching
 * `TrainingRecord.computedStatus`'s own established "cheaply derivable,
 * don't store a driftable copy" discipline.
 */
@Injectable()
export class TrainingComplianceService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async createCurriculum(
    actor: AuthenticatedUser,
    dto: CreateRoleTrainingCurriculumDto,
    meta: RequestMeta,
  ): Promise<RoleTrainingCurriculum> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const trainingType = await tx.trainingTypeCatalogEntry.findUnique({
        where: { id: dto.trainingTypeId },
      })
      if (!trainingType) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Training type not found' })
      }

      const created = await tx.roleTrainingCurriculum.create({
        data: {
          id: newId(),
          companyId,
          roleKey: dto.roleKey,
          trainingTypeId: dto.trainingTypeId,
          isMandatory: dto.isMandatory ?? true,
          recertificationIntervalMonths: dto.recertificationIntervalMonths ?? null,
          documentTypeTrigger: dto.documentTypeTrigger ?? null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'role_training_curriculum_created',
        recordType: ROLE_TRAINING_CURRICULUM_RECORD_TYPE,
        recordId: created.id,
        newValue: { roleKey: dto.roleKey, trainingTypeId: dto.trainingTypeId },
        ip: meta.ip,
      })

      return created
    })
  }

  async listCurriculum(actor: AuthenticatedUser): Promise<RoleTrainingCurriculum[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.roleTrainingCurriculum.findMany({
        where: { companyId },
        include: { trainingType: true },
        orderBy: [{ roleKey: 'asc' }],
      }),
    )
  }

  async removeCurriculum(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<void> {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.roleTrainingCurriculum.findFirst({ where: { id, companyId } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Curriculum row not found' })
      await tx.roleTrainingCurriculum.delete({ where: { id } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'role_training_curriculum_removed',
        recordType: ROLE_TRAINING_CURRICULUM_RECORD_TYPE,
        recordId: id,
        ip: meta.ip,
      })
    })
  }

  /** Cross-references the target user's live `roleKeys` against this company's curriculum, computed live at every call. */
  async getComplianceStatus(actor: AuthenticatedUser, userId: string): Promise<ComplianceStatusRow[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, companyId } })
      if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' })

      if (user.roleKeys.length === 0) return []

      const curricula = await tx.roleTrainingCurriculum.findMany({
        where: { companyId, roleKey: { in: user.roleKeys } },
        include: { trainingType: true },
      })

      const rows: ComplianceStatusRow[] = []
      for (const curriculum of curricula) {
        const latest = await tx.trainingRecord.findFirst({
          where: { companyId, userId, trainingType: curriculum.trainingType.typeKey },
          orderBy: { completionDate: 'desc' },
        })
        rows.push({
          curriculumId: curriculum.id,
          roleKey: curriculum.roleKey,
          trainingTypeId: curriculum.trainingTypeId,
          trainingTypeLabel: curriculum.trainingType.label,
          isMandatory: curriculum.isMandatory,
          status: latest ? computeTrainingStatus(latest.expiryDate) : 'missing',
          latestTrainingRecordId: latest?.id ?? null,
          latestCompletionDate: latest?.completionDate ?? null,
          latestExpiryDate: latest?.expiryDate ?? null,
        })
      }
      return rows
    })
  }

  // ── Competency assessments ─────────────────────────────────────────────

  async recordCompetencyAssessment(
    actor: AuthenticatedUser,
    dto: CreateCompetencyAssessmentDto,
    meta: RequestMeta,
  ): Promise<CompetencyAssessment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const trainingRecord = await tx.trainingRecord.findFirst({
        where: { id: dto.trainingRecordId, companyId },
      })
      if (!trainingRecord) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Training record not found' })
      }

      const created = await tx.competencyAssessment.create({
        data: {
          id: newId(),
          companyId,
          trainingRecordId: dto.trainingRecordId,
          assessmentMethod: dto.assessmentMethod,
          result: dto.result,
          notes: dto.notes ?? null,
          assessedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'competency_assessment_recorded',
        recordType: 'training_record',
        recordId: dto.trainingRecordId,
        newValue: { assessmentMethod: dto.assessmentMethod, result: dto.result },
        ip: meta.ip,
      })

      return created
    })
  }

  async listCompetencyAssessments(
    actor: AuthenticatedUser,
    trainingRecordId: string,
  ): Promise<CompetencyAssessment[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.competencyAssessment.findMany({
        where: { companyId, trainingRecordId },
        orderBy: { assessedAt: 'desc' },
      }),
    )
  }

  /**
   * The real new-SOP-rollout side effect — called from
   * `QualityWorkflowGuards`' own `quality_controlled_document`
   * status-sync the moment a `Sop` goes `effective`, inside that same
   * transaction. Every curriculum row whose `documentTypeTrigger`
   * matches this SOP's `documentType` gets every active user holding
   * that `roleKey` a real `DocumentAcknowledgment` row — a genuine side
   * effect, not a TODO.
   */
  async rolloutForEffectiveSop(tx: Prisma.TransactionClient, companyId: string, sop: Sop): Promise<number> {
    const curricula = await tx.roleTrainingCurriculum.findMany({
      where: { companyId, documentTypeTrigger: sop.documentType },
    })
    if (curricula.length === 0) return 0

    const roleKeys = [...new Set(curricula.map((c) => c.roleKey))]
    const users = await tx.user.findMany({
      where: { companyId, status: 'active', roleKeys: { hasSome: roleKeys } },
      select: { id: true },
    })

    let created = 0
    for (const user of users) {
      const existing = await tx.documentAcknowledgment.findUnique({
        where: {
          sopId_userId_versionAcknowledged: {
            sopId: sop.id,
            userId: user.id,
            versionAcknowledged: sop.currentVersion,
          },
        },
      })
      if (existing) continue
      await tx.documentAcknowledgment.create({
        data: {
          id: newId(),
          companyId,
          sopId: sop.id,
          userId: user.id,
          versionAcknowledged: sop.currentVersion,
        },
      })
      created += 1
    }
    return created
  }
}
