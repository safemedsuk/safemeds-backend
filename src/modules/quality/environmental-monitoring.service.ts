import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { EnvironmentalMonitoringResult } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginatedResult } from '../../common/pagination/paginated-result'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { TasksService } from '../tasks/tasks.service'
import { RecordEnvironmentalMonitoringResultDto } from './dto/environmental-monitoring.dto'

export interface RequestMeta {
  ip?: string
}

export const ENVIRONMENTAL_MONITORING_RECORD_TYPE = 'environmental_monitoring_result'

/**
 * QualCloud (Phase 13) Stage 19 — EU GMP Annex 1's own commonly-
 * published reference limits per cleanroom grade, "at rest" viable air
 * (cfu/m³) — used only as a default when the caller doesn't supply its
 * own alert/action limit, never hardcoded as the only truth (any site's
 * own validated limit can differ and is always respected when given).
 * Non-numeric monitoring types (surface/personnel/particle) have no
 * universal single-number default across grades — callers must supply
 * their own limits for those, matching the honest-degradation
 * discipline this codebase already applies elsewhere (no fabricated
 * number where no universal one exists).
 */
export const ENVIRONMENTAL_MONITORING_DEFAULT_VIABLE_AIR_LIMITS: Record<
  string,
  { alertLimit: string; actionLimit: string }
> = {
  A: { alertLimit: '<1', actionLimit: '1' },
  B: { alertLimit: '5', actionLimit: '10' },
  C: { alertLimit: '50', actionLimit: '100' },
  D: { alertLimit: '100', actionLimit: '200' },
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Environmental monitoring is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/** A plain numeric comparison when both sides parse as numbers; otherwise the caller's own pass/fail-shaped result string is trusted directly (viable counts are sometimes reported as "<1"/"TNTC," not a clean number). */
function computeExcursion(
  result: string,
  alertLimit?: string,
  actionLimit?: string,
): { excursion: boolean; excursionLevel: string | null } {
  const resultNum = Number(result)
  const actionNum = actionLimit !== undefined ? Number(actionLimit) : NaN
  const alertNum = alertLimit !== undefined ? Number(alertLimit) : NaN

  if (!Number.isNaN(resultNum)) {
    if (!Number.isNaN(actionNum) && resultNum > actionNum) {
      return { excursion: true, excursionLevel: 'action' }
    }
    if (!Number.isNaN(alertNum) && resultNum > alertNum) {
      return { excursion: true, excursionLevel: 'alert' }
    }
    return { excursion: false, excursionLevel: null }
  }

  // Non-numeric result (e.g. "fail", "growth_detected") — treat any
  // explicit failure-shaped word as an action-level excursion, never
  // silently pass a result this service can't actually compare.
  const normalized = result.trim().toLowerCase()
  if (['fail', 'growth_detected', 'tntc', 'exceeded'].includes(normalized)) {
    return { excursion: true, excursionLevel: 'action' }
  }
  return { excursion: false, excursionLevel: null }
}

/**
 * QualCloud (Phase 13) Stage 19 — Environmental Monitoring. An
 * excursion past the *action* limit opens a real `Task` for a human to
 * assess (via `TasksService.escalateForRecord()`, called *after* this
 * service's own write transaction has genuinely committed — the same
 * "slow/secondary work outside the main transaction" discipline this
 * codebase already established for Stage 12's PDF-then-upload split),
 * deliberately never auto-creating a `Deviation` directly — see
 * `EquipmentQualificationService.escalateOverdue()`'s own doc comment
 * for the exact precedent this follows and why (no honest "system"
 * actor to attribute a Deviation's own `raisedBy`/`createdBy` to).
 */
@Injectable()
export class EnvironmentalMonitoringService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
  ) {}

  async record(
    actor: AuthenticatedUser,
    dto: RecordEnvironmentalMonitoringResultDto,
    meta: RequestMeta,
  ): Promise<EnvironmentalMonitoringResult> {
    const companyId = requireCompany(actor)

    const defaultLimits =
      dto.monitoringType === 'viable_air'
        ? ENVIRONMENTAL_MONITORING_DEFAULT_VIABLE_AIR_LIMITS[dto.cleanroomGrade]
        : undefined
    const alertLimit = dto.alertLimit ?? defaultLimits?.alertLimit
    const actionLimit = dto.actionLimit ?? defaultLimits?.actionLimit
    const { excursion, excursionLevel } = computeExcursion(dto.result, alertLimit, actionLimit)

    const created = await this.rls.runAsCompany(companyId, async (tx) => {
      const facility = await tx.facility.findFirst({ where: { id: dto.facilityId, companyId } })
      if (!facility) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Facility not found' })

      const row = await tx.environmentalMonitoringResult.create({
        data: {
          id: newId(),
          companyId,
          facilityId: dto.facilityId,
          cleanroomGrade: dto.cleanroomGrade,
          monitoringType: dto.monitoringType,
          sampleLocation: dto.sampleLocation ?? null,
          result: dto.result,
          alertLimit: alertLimit ?? null,
          actionLimit: actionLimit ?? null,
          excursion,
          excursionLevel,
          sampledAt: new Date(dto.sampledAt),
          notes: dto.notes ?? null,
          recordedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'environmental_monitoring_result_recorded',
        recordType: ENVIRONMENTAL_MONITORING_RECORD_TYPE,
        recordId: row.id,
        newValue: { cleanroomGrade: dto.cleanroomGrade, monitoringType: dto.monitoringType, result: dto.result, excursion, excursionLevel },
        ip: meta.ip,
      })

      return row
    })

    if (excursionLevel === 'action') {
      await this.tasksService.escalateForRecord(
        companyId,
        ENVIRONMENTAL_MONITORING_RECORD_TYPE,
        created.id,
        'overdue',
        `Action-limit excursion — ${dto.monitoringType.replace(/_/g, ' ')} grade ${dto.cleanroomGrade} result ${dto.result}${dto.sampleLocation ? ` (${dto.sampleLocation})` : ''} — assess for a Deviation`,
        meta,
      )
    }

    return created
  }

  async list(
    actor: AuthenticatedUser,
    query: { facilityId?: string; excursionOnly?: boolean; page?: number; limit?: number },
  ): Promise<PaginatedResult<EnvironmentalMonitoringResult>> {
    const companyId = requireCompany(actor)
    const page = query.page ?? 1
    const limit = Math.min(query.limit ?? 20, 100)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.facilityId ? { facilityId: query.facilityId } : {}),
        ...(query.excursionOnly ? { excursion: true } : {}),
      }
      const [data, total] = await Promise.all([
        tx.environmentalMonitoringResult.findMany({
          where,
          orderBy: { sampledAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.environmentalMonitoringResult.count({ where }),
      ])
      return new PaginatedResult(data, { page, limit, total, totalPages: Math.ceil(total / limit) || 1 })
    })
  }
}
