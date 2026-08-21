import { ForbiddenException, Injectable } from '@nestjs/common'
import { LiteratureMonitoringRun } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ListLiteratureRunsQueryDto } from './dto/list-literature-runs-query.dto'
import { LogLiteratureRunDto } from './dto/log-literature-run.dto'
import { RequestMeta } from './pv-case.service'

export const LITERATURE_MONITORING_RUN_RECORD_TYPE = 'pv_literature_monitoring_run'

/**
 * Corrected 19 Aug 2026 from real field-expert source material
 * (`vigicloud document formats/Kenya Literature Review Guidelines.docx`
 * §2 "Required Search Frequency," independently corroborated by the same
 * folder's Internal Audit Requirements doc §4 and the PSMF template's
 * own SOP-PV-003 title, "Weekly Global and Regional Safety Literature
 * Monitoring") — GUD/022 itself doesn't specify a cadence, but PPB's own
 * separate guidance does: **weekly**, not the Final planning doc's
 * looser "monthly" wording this constant previously matched. A run
 * within the last ~7 days counts as current. Shared by the reminder job
 * and the audit-readiness resolver so both agree on what "current"
 * means; the reminder job itself was already scheduled weekly
 * (`pv.module.ts`), so only this currency threshold needed correcting,
 * not the job's own cadence.
 */
export const LITERATURE_MONITORING_CURRENCY_WINDOW_DAYS = 7

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Literature-monitoring runs are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 19 — the literature-monitoring log. Per the user's own
 * explicit instruction, this is a manually-logged screening event, never
 * an automated search — a staff member does their own literature search
 * (PubMed, a journal, etc.) outside this system and records what they
 * did here afterward. This satisfies Stage 16.2 requirement row 12
 * ("literature-monitoring evidence"): companies must *prove* they do
 * literature searches, which is exactly what this audit-trailed log is
 * for, not a smart search engine.
 */
@Injectable()
export class LiteratureMonitoringService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async logRun(
    actor: AuthenticatedUser,
    dto: LogLiteratureRunDto,
    meta: RequestMeta,
  ): Promise<LiteratureMonitoringRun> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const run = await tx.literatureMonitoringRun.create({
        data: {
          id: newId(),
          companyId,
          runAt: new Date(dto.runAt),
          method: dto.method,
          searchTerms: dto.searchTerms,
          hitsCount: dto.hitsCount,
          hitsSummary: dto.hitsSummary ?? null,
          loggedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'literature_monitoring_run_logged',
        recordType: LITERATURE_MONITORING_RUN_RECORD_TYPE,
        recordId: run.id,
        newValue: { method: dto.method, searchTerms: dto.searchTerms, hitsCount: dto.hitsCount },
        ip: meta.ip,
      })

      return run
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListLiteratureRunsQueryDto,
  ): Promise<PaginatedResult<LiteratureMonitoringRun>> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = { companyId }
      const [rows, total] = await Promise.all([
        tx.literatureMonitoringRun.findMany({
          where,
          orderBy: { runAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.literatureMonitoringRun.count({ where }),
      ])

      return paginate(rows, total, query)
    })
  }
}
