import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, RiskAssessment } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateRiskAssessmentDto } from './dto/create-risk-assessment.dto'
import { ListRiskAssessmentsQueryDto } from './dto/list-risk-assessments-query.dto'
import { UpdateRiskAssessmentDto } from './dto/update-risk-assessment.dto'
import { computeRiskScore } from './risk-score.util'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Risk assessments are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 0.3 — ICH Q9's live risk register. Any
 * future quality-event service creates a row against itself via the
 * polymorphic `sourceRecordType`/`sourceRecordId` pair, the same
 * pattern `Capa.createFrom()` now uses.
 */
@Injectable()
export class RiskAssessmentService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRiskAssessmentsQueryDto,
  ): Promise<PaginatedResult<RiskAssessment>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.RiskAssessmentWhereInput = {
        companyId,
        ...(query.sourceRecordType ? { sourceRecordType: query.sourceRecordType } : {}),
        ...(query.sourceRecordId ? { sourceRecordId: query.sourceRecordId } : {}),
        ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.riskAssessment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.riskAssessment.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RiskAssessment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.riskAssessment.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Risk assessment not found' })
      return found
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateRiskAssessmentDto,
    meta: RequestMeta,
  ): Promise<RiskAssessment> {
    const companyId = requireCompany(actor)
    const { score, riskLevel } = computeRiskScore(dto.severity, dto.probability, dto.detectability)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.riskAssessment.create({
        data: {
          id: newId(),
          companyId,
          sourceRecordType: dto.sourceRecordType ?? null,
          sourceRecordId: dto.sourceRecordId ?? null,
          title: dto.title,
          riskMethod: dto.riskMethod ?? 'risk_matrix_2x2',
          severity: dto.severity,
          probability: dto.probability,
          detectability: dto.detectability ?? null,
          score,
          riskLevel,
          mitigationActions: dto.mitigationActions ?? null,
          capaId: dto.capaId ?? null,
          createdBy: actor.sub,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'risk_assessment_created',
        recordType: 'risk_assessment',
        recordId: created.id,
        newValue: { title: created.title, score, riskLevel },
        ip: meta.ip,
      })
      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRiskAssessmentDto,
    meta: RequestMeta,
  ): Promise<RiskAssessment> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.riskAssessment.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Risk assessment not found' })

      const severity = dto.severity ?? existing.severity
      const probability = dto.probability ?? existing.probability
      const detectability =
        dto.detectability !== undefined ? dto.detectability : existing.detectability
      const { score, riskLevel } = computeRiskScore(severity, probability, detectability)

      const updated = await tx.riskAssessment.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          severity,
          probability,
          detectability,
          score,
          riskLevel,
          ...(dto.mitigationActions !== undefined
            ? { mitigationActions: dto.mitigationActions }
            : {}),
          ...(dto.capaId !== undefined ? { capaId: dto.capaId } : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'risk_assessment_updated',
        recordType: 'risk_assessment',
        recordId: id,
        oldValue: { score: existing.score, riskLevel: existing.riskLevel },
        newValue: { score, riskLevel },
        ip: meta.ip,
      })
      return updated
    })
  }
}
