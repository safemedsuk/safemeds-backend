import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { GeneratedReport, Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult, resolveSort } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { CreateGeneratedReportDto } from './dto/create-generated-report.dto'
import { ListGeneratedReportsQueryDto } from './dto/list-generated-reports-query.dto'

export interface RequestMeta {
  ip?: string
}

const SORTABLE_FIELDS = ['createdAt', 'dueAt', 'title', 'status'] as const

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Generated reports are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 0.10 — a generic "Reports" primitive: create/store/track
 * any module's generated output (PSUR, line listing, batch-release report,
 * registration-renewal report, ...) through draft → final → submitted. The
 * actual generated file is NOT stored here — it reuses the existing
 * polymorphic Document/DocumentVersion storage
 * (`recordType: 'generated_report'`, `recordId: report.id`), so this
 * service only owns the report's lifecycle metadata.
 *
 * Real-usage request, 11 Sep 2026 — a periodic report (PSUR/PBRER/DSUR/
 * PADER/CIOMS-II) now drives its own lifecycle through a real
 * `periodic_report` `WorkflowInstance` (QC review, QPPV sign-off+submit
 * — see `PeriodicReportService`'s own doc comment), so this generic
 * single-click `finalize()`/`submit()` pair — which has no role/
 * signature gating at all beyond the blanket `reports.manage`
 * permission — must not be usable as a bypass around that real
 * process. Both methods now check for, and reject on, exactly that.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateGeneratedReportDto,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: newId(),
          companyId,
          moduleKey: dto.moduleKey,
          reportTypeKey: dto.reportTypeKey,
          title: dto.title,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
          recordType: dto.recordType,
          recordId: dto.recordId,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
          status: 'draft',
          generatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'generated_report_created',
        recordType: 'generated_report',
        recordId: created.id,
        newValue: {
          moduleKey: created.moduleKey,
          reportTypeKey: created.reportTypeKey,
          title: created.title,
          status: created.status,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListGeneratedReportsQueryDto,
  ): Promise<PaginatedResult<GeneratedReport>> {
    const companyId = requireCompany(actor)
    const sort = resolveSort(query.sort, SORTABLE_FIELDS, { field: 'createdAt', direction: 'desc' })

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.GeneratedReportWhereInput = {
        companyId,
        ...(query.moduleKey ? { moduleKey: query.moduleKey } : {}),
        ...(query.reportTypeKey ? { reportTypeKey: query.reportTypeKey } : {}),
        ...(query.status ? { status: query.status } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.generatedReport.findMany({
          where,
          orderBy: { [sort.field]: sort.direction },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.generatedReport.count({ where }),
      ])

      return paginate(rows, total, query)
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<GeneratedReport & { workflowInstanceId: string | null }> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const report = await this.findOrThrow(tx, companyId, id)
      // Real-usage request, 11 Sep 2026 — surfaced here (not just on the
      // `generate()` response) so revisiting a periodic report after a
      // reload still has what `WorkflowActionsPanel` needs, matching
      // `PvCaseService.get()`'s own precedent.
      const instance = await tx.workflowInstance.findFirst({
        where: { recordType: 'periodic_report', recordId: id },
      })
      return { ...report, workflowInstanceId: instance?.id ?? null }
    })
  }

  async finalize(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId, id)
      await this.rejectIfPeriodicReportWorkflow(tx, id)
      if (existing.status !== 'draft') {
        throw new ConflictException({
          code: 'NOT_DRAFT',
          message: `Cannot finalize a report that is already "${existing.status}"`,
        })
      }

      const updated = await tx.generatedReport.update({ where: { id }, data: { status: 'final' } })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'generated_report_finalized',
        recordType: 'generated_report',
        recordId: id,
        oldValue: { status: existing.status },
        newValue: { status: updated.status },
        ip: meta.ip,
      })

      return updated
    })
  }

  async submit(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId, id)
      await this.rejectIfPeriodicReportWorkflow(tx, id)
      if (existing.status !== 'final') {
        throw new ConflictException({
          code: 'NOT_FINAL',
          message: `Cannot submit a report that is "${existing.status}" — finalize it first`,
        })
      }

      const updated = await tx.generatedReport.update({
        where: { id },
        data: { status: 'submitted', submittedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'generated_report_submitted',
        recordType: 'generated_report',
        recordId: id,
        oldValue: { status: existing.status },
        newValue: { status: updated.status, submittedAt: updated.submittedAt },
        ip: meta.ip,
      })

      return updated
    })
  }

  private async findOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<GeneratedReport> {
    const report = await tx.generatedReport.findFirst({ where: { id, companyId } })
    if (!report) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report not found' })
    return report
  }

  private async rejectIfPeriodicReportWorkflow(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    const instance = await tx.workflowInstance.findFirst({
      where: { recordType: 'periodic_report', recordId: id },
    })
    if (instance) {
      throw new ConflictException({
        code: 'USE_WORKFLOW_ACTIONS',
        message:
          'This periodic report has its own review/sign-off workflow — use the Workflow Actions on the report instead of this generic action.',
      })
    }
  }
}
