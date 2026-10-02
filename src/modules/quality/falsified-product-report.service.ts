import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { DrugCharacterization, FalsifiedProductReport, Prisma, ReporterType } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { resolveDefaultReportType } from '../pv/default-report-type.util'
import { PvCaseService } from '../pv/pv-case.service'
import { DeviationService } from './deviation.service'
import { ConfirmFalsifiedProductReportDto } from './dto/confirm-falsified-product-report.dto'
import { CreateFalsifiedProductReportDto } from './dto/create-falsified-product-report.dto'
import { DismissFalsifiedProductReportDto } from './dto/dismiss-falsified-product-report.dto'
import { ListFalsifiedProductReportsQueryDto } from './dto/list-falsified-product-reports-query.dto'

export interface RequestMeta {
  ip?: string
}

export const FALSIFIED_PRODUCT_REPORT_RECORD_TYPE = 'falsified_product_report'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Falsified product reports are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * QualCloud (Phase 13) Stage 16 — Falsified & Substandard Product
 * Handling. `confirm()` is the single most important method: it always
 * opens a real `Deviation` (`sourceType: 'monitoring_alert'` — the
 * existing, matching value on that model's own taxonomy) and, where
 * product safety is implicated (`dto.routeToPvCase`), a real VigiCloud
 * PV case via the already-existing `PvCaseService.createFromSystemChannel()`
 * — the exact same mechanism `ComplaintService.classify()`'s own
 * possible-AE routing already uses, with an honest-minimal DTO built
 * from what a falsified-product report actually knows. Two sequential,
 * top-level calls, never nested inside one transaction — mirroring
 * `ComplaintService`'s own identical reasoning (each of
 * `DeviationService.create()`/`PvCaseService.createFromSystemChannel()`
 * opens its own transaction internally).
 *
 * The "scan feature" (QR/serialization scan-to-verify) is explicitly
 * out of scope for this pass — `source: 'scan_feature'` exists on the
 * create DTO as a real, forward-reserved enum value only, for when that
 * feature eventually exists; nothing here builds it.
 */
@Injectable()
export class FalsifiedProductReportService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly deviationService: DeviationService,
    private readonly pvCaseService: PvCaseService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListFalsifiedProductReportsQueryDto,
  ): Promise<PaginatedResult<FalsifiedProductReport>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.FalsifiedProductReportWhereInput = {
        companyId,
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.falsifiedProductReport.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.falsifiedProductReport.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<FalsifiedProductReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.falsifiedProductReport.findFirst({ where: { id, companyId } })
      if (!found)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Falsified product report not found' })
      return found
    })
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateFalsifiedProductReportDto,
    meta: RequestMeta,
  ): Promise<FalsifiedProductReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.falsifiedProductReport.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId ?? null,
          batchId: dto.batchId ?? null,
          reportedBy: actor.sub,
          source: dto.source,
          evidenceDescription: dto.evidenceDescription,
          evidenceDocumentIds: dto.evidenceDocumentIds ?? [],
          status: 'reported',
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'falsified_product_report_created',
        recordType: FALSIFIED_PRODUCT_REPORT_RECORD_TYPE,
        recordId: created.id,
        newValue: { source: created.source },
        ip: meta.ip,
      })

      return created
    })
  }

  async confirm(
    actor: AuthenticatedUser,
    id: string,
    dto: ConfirmFalsifiedProductReportDto,
    meta: RequestMeta,
  ): Promise<FalsifiedProductReport> {
    const companyId = requireCompany(actor)

    const report = await this.rls.runAsCompany(companyId, (tx) =>
      tx.falsifiedProductReport.findFirst({ where: { id, companyId } }),
    )
    if (!report)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Falsified product report not found' })
    if (report.status !== 'reported') {
      throw new ConflictException({
        code: 'ALREADY_DECIDED',
        message: `This report is already "${report.status}" and cannot be confirmed again`,
      })
    }

    // Sequential, outside any open transaction — see this class's own doc comment.
    const deviation = await this.deviationService.create(
      actor,
      {
        title: `Falsified/substandard product report — ${report.source}`,
        description: report.evidenceDescription,
        sourceType: 'monitoring_alert',
        productId: report.productId ?? undefined,
        batchId: report.batchId ?? undefined,
        detectedAt: report.createdAt.toISOString(),
      },
      meta,
    )

    let routedCaseId: string | null = null
    if (dto.routeToPvCase && report.productId) {
      const routed = await this.routeToPvCase(companyId, report, meta)
      routedCaseId = routed?.id ?? null
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.falsifiedProductReport.update({
        where: { id },
        data: {
          status: 'confirmed',
          linkedDeviationId: deviation.id,
          linkedCaseId: routedCaseId,
          authorityNotified: dto.authorityNotified ?? report.authorityNotified,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'falsified_product_report_confirmed',
        recordType: FALSIFIED_PRODUCT_REPORT_RECORD_TYPE,
        recordId: id,
        newValue: { linkedDeviationId: deviation.id, linkedCaseId: routedCaseId },
        ip: meta.ip,
      })

      return updated
    })
  }

  private async routeToPvCase(
    companyId: string,
    report: FalsifiedProductReport,
    meta: RequestMeta,
  ): Promise<{ id: string; referenceNumber: string } | null> {
    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId } }),
    )
    const product = await this.rls.runAsCompany(companyId, (tx) =>
      tx.product.findUnique({ where: { id: report.productId! } }),
    )
    if (!product) return null
    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    if (!reportType) return null
    const today = new Date().toISOString().slice(0, 10)

    const created = await this.pvCaseService.createFromSystemChannel(
      companyId,
      {
        reportTypeId: reportType.id,
        countryOfOccurrenceId: company.homeCountryId,
        countryOfReportId: company.homeCountryId,
        awarenessDate: today,
        receivedDate: today,
        additionalInformation: `Routed from falsified/substandard product report (source: ${report.source}).`,
        reporter: { reporterType: ReporterType.consumer },
        patient: {},
        suspectProducts: [
          {
            drugCharacterization: DrugCharacterization.suspect,
            medicinalProduct: product.brandName,
            productId: product.id,
          },
        ],
        adverseEvents: [
          {
            reportedTerm: 'Suspected falsified or substandard product',
            narrative: report.evidenceDescription,
          },
        ],
      },
      'quality_complaint_routed',
      report.id,
      meta,
    )

    return { id: created.id, referenceNumber: created.referenceNumber }
  }

  async dismiss(
    actor: AuthenticatedUser,
    id: string,
    dto: DismissFalsifiedProductReportDto,
    meta: RequestMeta,
  ): Promise<FalsifiedProductReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.falsifiedProductReport.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Falsified product report not found' })
      if (existing.status !== 'reported') {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: `This report is already "${existing.status}" and cannot be dismissed`,
        })
      }

      const updated = await tx.falsifiedProductReport.update({
        where: { id },
        data: { status: 'dismissed', dismissedReason: dto.reason },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'falsified_product_report_dismissed',
        recordType: FALSIFIED_PRODUCT_REPORT_RECORD_TYPE,
        recordId: id,
        newValue: { reason: dto.reason },
        ip: meta.ip,
      })

      return updated
    })
  }

  async close(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<FalsifiedProductReport> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.falsifiedProductReport.findFirst({ where: { id, companyId } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Falsified product report not found' })
      if (existing.status !== 'confirmed') {
        throw new ConflictException({
          code: 'NOT_CONFIRMED',
          message: 'Only a confirmed report can be closed',
        })
      }

      const updated = await tx.falsifiedProductReport.update({ where: { id }, data: { status: 'closed' } })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'falsified_product_report_closed',
        recordType: FALSIFIED_PRODUCT_REPORT_RECORD_TYPE,
        recordId: id,
        newValue: {},
        ip: meta.ip,
      })

      return updated
    })
  }
}
