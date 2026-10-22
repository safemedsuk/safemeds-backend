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
import {
  buildRiskRegisterRows,
  RISK_REGISTER_COLUMNS,
  RiskRegisterLookups,
  toRiskRegisterCsv,
  toRiskRegisterXlsx,
} from './risk-register-export.util'
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
  /**
   * Phase 2 Pass C — the full risk register as Excel or CSV. Every row
   * is included (no pagination), each source record is resolved to its
   * readable reference, and the export itself is audited.
   */
  async exportRegister(
    actor: AuthenticatedUser,
    format: 'xlsx' | 'csv',
    meta: RequestMeta,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string; rowCount: number }> {
    const companyId = requireCompany(actor)
    const rows = await this.rls.runAsCompany(companyId, async (tx) => {
      const risks = await tx.riskAssessment.findMany({
        where: { companyId },
        orderBy: { createdAt: 'asc' },
      })

      const idsByType = new Map<string, Set<string>>()
      for (const r of risks) {
        if (!r.sourceRecordType || !r.sourceRecordId) continue
        const set = idsByType.get(r.sourceRecordType) ?? new Set<string>()
        set.add(r.sourceRecordId)
        idsByType.set(r.sourceRecordType, set)
      }
      const sourceRefs = new Map<string, string>()
      const fetchRefs = async (
        type: string,
        model: () => Promise<Array<{ id: string; ref: string }>>,
      ) => {
        if (!idsByType.has(type)) return
        for (const row of await model()) sourceRefs.set(`${type}:${row.id}`, row.ref)
      }
      const ids = (type: string) => [...(idsByType.get(type) ?? [])]
      await fetchRefs('deviation', async () =>
        (
          await tx.deviation.findMany({
            where: { companyId, id: { in: ids('deviation') } },
            select: { id: true, deviationNumber: true },
          })
        ).map((d) => ({ id: d.id, ref: d.deviationNumber })),
      )
      await fetchRefs('oos', async () =>
        (
          await tx.oos.findMany({
            where: { companyId, id: { in: ids('oos') } },
            select: { id: true, oosNumber: true },
          })
        ).map((d) => ({ id: d.id, ref: d.oosNumber })),
      )
      await fetchRefs('complaint', async () =>
        (
          await tx.complaint.findMany({
            where: { companyId, id: { in: ids('complaint') } },
            select: { id: true, complaintNumber: true },
          })
        ).map((d) => ({ id: d.id, ref: d.complaintNumber })),
      )
      await fetchRefs('change_control', async () =>
        (
          await tx.changeControl.findMany({
            where: { companyId, id: { in: ids('change_control') } },
            select: { id: true, changeNumber: true },
          })
        ).map((d) => ({ id: d.id, ref: d.changeNumber })),
      )
      await fetchRefs('recall', async () =>
        (
          await tx.recall.findMany({
            where: { companyId, id: { in: ids('recall') } },
            select: { id: true, ref: true },
          })
        ).map((d) => ({ id: d.id, ref: d.ref ?? d.id })),
      )
      await fetchRefs('batch', async () =>
        (
          await tx.batch.findMany({
            where: { companyId, id: { in: ids('batch') } },
            select: { id: true, batchNumber: true },
          })
        ).map((d) => ({ id: d.id, ref: d.batchNumber })),
      )
      await fetchRefs('product', async () =>
        (
          await tx.product.findMany({
            where: { companyId, id: { in: ids('product') } },
            select: { id: true, brandName: true },
          })
        ).map((d) => ({ id: d.id, ref: d.brandName })),
      )
      await fetchRefs('capa', async () =>
        (
          await tx.capa.findMany({
            where: { companyId, id: { in: ids('capa') } },
            select: { id: true, title: true },
          })
        ).map((d) => ({ id: d.id, ref: d.title })),
      )

      const capaIds = [
        ...new Set(risks.map((r) => r.capaId).filter((x): x is string => Boolean(x))),
      ]
      const capaRows = capaIds.length
        ? await tx.capa.findMany({
            where: { companyId, id: { in: capaIds } },
            select: { id: true, title: true, status: true },
          })
        : []
      const capas = new Map(
        capaRows.map((c) => [c.id, { title: c.title, status: String(c.status) }]),
      )

      const userIds = [
        ...new Set(risks.map((r) => r.createdBy).filter((x): x is string => Boolean(x))),
      ]
      const users = userIds.length
        ? await tx.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true },
          })
        : []
      const userNames = new Map(users.map((u) => [u.id, u.fullName]))

      const lookups: RiskRegisterLookups = { sourceRefs, userNames, capas }
      return buildRiskRegisterRows(
        risks.map((r) => ({ ...r, method: r.riskMethod })),
        lookups,
      )
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const filenameBase = `risk-register-${stamp}`
    const buffer =
      format === 'xlsx'
        ? await toRiskRegisterXlsx(rows)
        : Buffer.from(toRiskRegisterCsv(rows), 'utf8')

    await this.rls.runAsCompany(companyId, (tx) =>
      this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'risk_register_exported',
        recordType: 'risk_assessment',
        recordId: companyId,
        newValue: { format, rowCount: rows.length, columns: RISK_REGISTER_COLUMNS.length },
        ip: meta.ip,
      }),
    )

    return {
      buffer,
      filename: `${filenameBase}.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      rowCount: rows.length,
    }
  }
}
