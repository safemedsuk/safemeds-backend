import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { StabilityStudy, StabilityTimepoint } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import {
  CreateStabilityStudyDto,
  RecordStabilityTimepointResultsDto,
  UpdateStabilityStudyStatusDto,
} from './dto/stability.dto'

export interface RequestMeta {
  ip?: string
}

export const STABILITY_STUDY_RECORD_TYPE = 'stability_study'

/** 🧭 ICH Q1A(R2)'s own standard stability-testing schedule — used whenever a caller doesn't supply its own timepoint list. */
export const DEFAULT_STABILITY_TIMEPOINT_MONTHS = [0, 3, 6, 9, 12, 18, 24, 36]

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Stability studies are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/** Numeric range check when the limit is a real range/number; qualitative limits (e.g. "complies") are matched by case-insensitive equality — the same two-shape handling `SpecificationParameter.lowerLimit`/`upperLimit`'s own doc comment already anticipates. */
function resultWithinLimit(result: string, lowerLimit: string | null, upperLimit: string | null): boolean {
  const resultNum = Number(result)
  const lowerNum = lowerLimit !== null ? Number(lowerLimit) : NaN
  const upperNum = upperLimit !== null ? Number(upperLimit) : NaN

  if (!Number.isNaN(resultNum) && (!Number.isNaN(lowerNum) || !Number.isNaN(upperNum))) {
    if (!Number.isNaN(lowerNum) && resultNum < lowerNum) return false
    if (!Number.isNaN(upperNum) && resultNum > upperNum) return false
    return true
  }

  // Qualitative criterion — e.g. "complies", "white to off-white powder".
  if (upperLimit) return result.trim().toLowerCase() === upperLimit.trim().toLowerCase()
  if (lowerLimit) return result.trim().toLowerCase() === lowerLimit.trim().toLowerCase()
  return true
}

/**
 * QualCloud (Phase 13) Stage 19 — Stability Programme. `createStudy()`
 * seeds the full real timepoint schedule up front (`scheduled`, no
 * results yet) rather than letting timepoints be created ad hoc — a
 * stability protocol's whole pull schedule is fixed at study start,
 * per ICH Q1A(R2). `recordResults()` compares each submitted result
 * against its own `SpecificationParameter`'s real limits (reusing
 * `Specification`/`SpecificationParameter` exactly like `Oos`/
 * `CertificateOfAnalysis` already do, never a second parallel
 * spec-like concept) and computes the timepoint's own `withinSpec`
 * from every result's own pass/fail, never re-derived later.
 */
@Injectable()
export class StabilityService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async createStudy(
    actor: AuthenticatedUser,
    dto: CreateStabilityStudyDto,
    meta: RequestMeta,
  ): Promise<StabilityStudy> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: dto.productId, companyId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const study = await tx.stabilityStudy.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          batchId: dto.batchId ?? null,
          specificationId: dto.specificationId ?? null,
          storageCondition: dto.storageCondition,
          startDate: new Date(dto.startDate),
          createdBy: actor.sub,
        },
      })

      const months = dto.timepointMonths ?? DEFAULT_STABILITY_TIMEPOINT_MONTHS
      await tx.stabilityTimepoint.createMany({
        data: months.map((m) => ({
          id: newId(),
          companyId,
          stabilityStudyId: study.id,
          timepointMonths: m,
        })),
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'stability_study_created',
        recordType: STABILITY_STUDY_RECORD_TYPE,
        recordId: study.id,
        newValue: { productId: dto.productId, storageCondition: dto.storageCondition, timepointMonths: months },
        ip: meta.ip,
      })

      return study
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<StabilityStudy & { timepoints: StabilityTimepoint[] }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const study = await tx.stabilityStudy.findFirst({
        where: { id, companyId },
        include: { timepoints: { orderBy: { timepointMonths: 'asc' } } },
      })
      if (!study) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stability study not found' })
      return study
    })
  }

  async list(actor: AuthenticatedUser, productId?: string): Promise<StabilityStudy[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.stabilityStudy.findMany({
        where: { companyId, ...(productId ? { productId } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    )
  }

  async recordResults(
    actor: AuthenticatedUser,
    timepointId: string,
    dto: RecordStabilityTimepointResultsDto,
    meta: RequestMeta,
  ): Promise<StabilityTimepoint> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const timepoint = await tx.stabilityTimepoint.findFirst({ where: { id: timepointId, companyId } })
      if (!timepoint)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stability timepoint not found' })

      const parameters = await tx.specificationParameter.findMany({
        where: { id: { in: dto.results.map((r) => r.parameterId) } },
      })
      const byId = new Map(parameters.map((p) => [p.id, p]))

      const results = dto.results.map((r) => {
        const param = byId.get(r.parameterId)
        const withinSpec = param ? resultWithinLimit(r.result, param.lowerLimit, param.upperLimit) : null
        return {
          parameterId: r.parameterId,
          parameterName: param?.parameterName ?? 'Unknown parameter',
          result: r.result,
          withinSpec,
        }
      })
      const overallWithinSpec = results.every((r) => r.withinSpec !== false)

      const updated = await tx.stabilityTimepoint.update({
        where: { id: timepointId },
        data: {
          pullDate: new Date(dto.pullDate),
          status: 'results_recorded',
          results,
          withinSpec: overallWithinSpec,
          recordedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'stability_timepoint_results_recorded',
        recordType: STABILITY_STUDY_RECORD_TYPE,
        recordId: timepoint.stabilityStudyId,
        newValue: { timepointId, timepointMonths: timepoint.timepointMonths, withinSpec: overallWithinSpec },
        ip: meta.ip,
      })

      return updated
    })
  }

  async updateStatus(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateStabilityStudyStatusDto,
    meta: RequestMeta,
  ): Promise<StabilityStudy> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const study = await tx.stabilityStudy.findFirst({ where: { id, companyId } })
      if (!study) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Stability study not found' })

      const updated = await tx.stabilityStudy.update({ where: { id }, data: { status: dto.status } })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'stability_study_status_updated',
        recordType: STABILITY_STUDY_RECORD_TYPE,
        recordId: id,
        newValue: { status: dto.status },
        ip: meta.ip,
      })

      return updated
    })
  }

  /**
   * Stage 19 → `PqrService.assemble()`'s own `stabilityNote` field —
   * see that service's doc comment, which named this exact gap. A
   * real, honest summary: whether an in-progress study exists for the
   * product, and whether the most recent recorded timepoint across any
   * study for it was within spec. Never fabricates a number for a
   * product with zero stability data — returns the same honest
   * "not yet applicable" shape that field already had.
   */
  async summarizeForPqr(
    companyId: string,
    productId: string,
  ): Promise<{ stabilityNote: string; studyCount: number; latestTimepointWithinSpec: boolean | null }> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const studies = await tx.stabilityStudy.findMany({
        where: { companyId, productId },
        include: { timepoints: { orderBy: { pullDate: 'desc' } } },
      })
      if (studies.length === 0) {
        return {
          stabilityNote: 'Not yet applicable — no stability study exists for this product.',
          studyCount: 0,
          latestTimepointWithinSpec: null,
        }
      }

      const recordedTimepoints = studies
        .flatMap((s) => s.timepoints)
        .filter((t) => t.status === 'results_recorded' && t.pullDate)
        .sort((a, b) => (b.pullDate as Date).getTime() - (a.pullDate as Date).getTime())

      if (recordedTimepoints.length === 0) {
        return {
          stabilityNote: `${studies.length} stability stud(y/ies) in progress — no timepoint results recorded yet.`,
          studyCount: studies.length,
          latestTimepointWithinSpec: null,
        }
      }

      const latest = recordedTimepoints[0]
      return {
        stabilityNote: latest.withinSpec
          ? `${studies.length} stability stud(y/ies) on file — most recent recorded timepoint (month ${latest.timepointMonths}) within specification.`
          : `${studies.length} stability stud(y/ies) on file — most recent recorded timepoint (month ${latest.timepointMonths}) OUT OF SPECIFICATION, review required.`,
        studyCount: studies.length,
        latestTimepointWithinSpec: latest.withinSpec,
      }
    })
  }
}
