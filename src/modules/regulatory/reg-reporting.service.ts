import { ForbiddenException, Injectable } from '@nestjs/common'
import { GeneratedReport } from '@prisma/client'
import ExcelJS from 'exceljs'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { GenerateUpcomingRenewalsReportDto } from './dto/generate-upcoming-renewals-report.dto'

export interface RequestMeta {
  ip?: string
}

export const REG_PORTFOLIO_STATUS_REPORT_TYPE_KEY = 'reg_portfolio_status'
export const REG_UPCOMING_RENEWALS_REPORT_TYPE_KEY = 'reg_upcoming_renewals'
export const REG_DOSSIER_TURNAROUND_REPORT_TYPE_KEY = 'reg_dossier_turnaround'

const DEFAULT_RENEWALS_WINDOW_DAYS = 90
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'RegCloud reports are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

async function bufferOf(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * RegCloud (Phase 12) Stage 17 — Reporting, Dashboards & Regulatory
 * Intelligence. Reuses `GeneratedReport` exactly as `todo-regcloud.md`'s
 * own text instructs ("no new report-output primitive") — three
 * real, live-computed `.xlsx` exports, mirroring `LineListingService`'s
 * own established `exceljs` pattern (the closest existing precedent for
 * a tabular RegCloud-shaped output; `RegPostMarketObligationPdfService`'s
 * own doc comment explicitly names "Stage 17's own future dashboard-
 * level output" as exactly the deliberately-deferred territory this
 * service now fills). No new content is invented — every column comes
 * from data this codebase's own Stages 0–14 already collect.
 */
@Injectable()
export class RegReportingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  /** One row per dossier — product, authority, class, status, and (once approved) the resulting registration number/expiry. */
  async generatePortfolioStatusReport(
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    const { companyName, rows } = await this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
      const dossiers = await tx.regDossier.findMany({
        where: { companyId },
        include: {
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
          productRegistration: {
            select: { registrationNumber: true, expiresOn: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      return { companyName: company.name, rows: dossiers }
    })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Portfolio Status')
    sheet.addRow([`${companyName} — Regulatory Portfolio Status`])
    sheet.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`])
    sheet.addRow([])
    const header = sheet.addRow([
      'Product',
      'Authority',
      'Product Class',
      'Dossier Status',
      'Registration Number',
      'Registration Status',
      'Expires On',
      'Started',
    ])
    header.font = { bold: true }
    for (const d of rows) {
      sheet.addRow([
        d.product.brandName,
        `${d.authority.name} (${d.authority.code})`,
        d.productClass,
        d.status.replace(/_/g, ' '),
        d.productRegistration?.registrationNumber ?? '—',
        d.productRegistration?.status ?? '—',
        d.productRegistration?.expiresOn
          ? d.productRegistration.expiresOn.toISOString().slice(0, 10)
          : '—',
        d.createdAt.toISOString().slice(0, 10),
      ])
    }
    sheet.columns.forEach((c) => (c.width = 22))

    return this.finalize(
      actor,
      companyId,
      REG_PORTFOLIO_STATUS_REPORT_TYPE_KEY,
      'Regulatory Portfolio Status',
      await bufferOf(workbook),
      meta,
      { dossierCount: rows.length },
    )
  }

  /** One row per upcoming renewal deadline within the given window (default 90 days) — reuses `RegDeadline` (Stage 0.4's own deadline engine) directly, no new computation. */
  async generateUpcomingRenewalsReport(
    actor: AuthenticatedUser,
    dto: GenerateUpcomingRenewalsReportDto,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)
    const withinDays = dto.withinDays ?? DEFAULT_RENEWALS_WINDOW_DAYS
    const horizon = addDays(new Date(), withinDays)

    const { companyName, rows } = await this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
      const deadlines = await tx.regDeadline.findMany({
        where: {
          companyId,
          recordType: 'reg_registration_renewal',
          status: 'pending',
          dueAt: { lte: horizon },
        },
        orderBy: { dueAt: 'asc' },
      })

      const registrationIds = deadlines.map((d) => d.recordId)
      const registrations = await tx.productRegistration.findMany({
        where: { id: { in: registrationIds } },
        include: {
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
        },
      })
      const byId = new Map(registrations.map((r) => [r.id, r]))

      return {
        companyName: company.name,
        rows: deadlines.map((d) => ({ deadline: d, registration: byId.get(d.recordId) })),
      }
    })

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Upcoming Renewals')
    sheet.addRow([`${companyName} — Upcoming Registration Renewals (within ${withinDays} days)`])
    sheet.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`])
    sheet.addRow([])
    const header = sheet.addRow([
      'Product',
      'Authority',
      'Registration Number',
      'Due',
      'Days Remaining',
    ])
    header.font = { bold: true }
    const now = Date.now()
    for (const { deadline, registration } of rows) {
      const daysRemaining = Math.ceil((deadline.dueAt.getTime() - now) / (24 * 60 * 60 * 1000))
      sheet.addRow([
        registration?.product.brandName ?? '—',
        registration ? `${registration.authority.name} (${registration.authority.code})` : '—',
        registration?.registrationNumber ?? '—',
        deadline.dueAt.toISOString().slice(0, 10),
        daysRemaining,
      ])
    }
    sheet.columns.forEach((c) => (c.width = 22))

    return this.finalize(
      actor,
      companyId,
      REG_UPCOMING_RENEWALS_REPORT_TYPE_KEY,
      `Upcoming Renewals — within ${withinDays} days`,
      await bufferOf(workbook),
      meta,
      { withinDays, count: rows.length },
    )
  }

  /**
   * One row per dossier that has reached a terminal state, with the
   * elapsed calendar days from its first `planning` transition to its
   * `approved`/`rejected` one — computed from the audit trail's own
   * `state_change` entries (the same source `transitionHistory` reads
   * elsewhere in this codebase), never a second parallel timestamp
   * column.
   */
  async generateDossierTurnaroundReport(
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    const { companyName, rows } = await this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })
      const dossiers = await tx.regDossier.findMany({
        where: { companyId, status: { in: ['approved', 'rejected'] } },
        include: {
          product: { select: { brandName: true } },
          authority: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return { companyName: company.name, rows: dossiers }
    })

    const entries: { dossierId: string; occurredAt: Date }[] = []
    for (const d of rows) {
      const historyPage = await this.auditService.query(actor, {
        recordType: 'reg_registration',
        recordId: d.id,
        action: 'state_change',
        page: 1,
        limit: 50,
      })
      entries.push(...historyPage.data.map((e) => ({ dossierId: d.id, occurredAt: e.occurredAt })))
    }

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Dossier Turnaround')
    sheet.addRow([`${companyName} — Dossier Turnaround-Time Analytics`])
    sheet.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`])
    sheet.addRow([])
    const header = sheet.addRow([
      'Product',
      'Authority',
      'Final Status',
      'Started',
      'Finished',
      'Calendar Days',
    ])
    header.font = { bold: true }

    let totalDays = 0
    let counted = 0
    for (const d of rows) {
      const own = entries.filter((e) => e.dossierId === d.id).map((e) => e.occurredAt.getTime())
      const started =
        own.length > 0 ? new Date(Math.min(...own, d.createdAt.getTime())) : d.createdAt
      const finished = own.length > 0 ? new Date(Math.max(...own)) : d.updatedAt
      const days = Math.max(
        0,
        Math.round((finished.getTime() - started.getTime()) / (24 * 60 * 60 * 1000)),
      )
      totalDays += days
      counted += 1
      sheet.addRow([
        d.product.brandName,
        `${d.authority.name} (${d.authority.code})`,
        d.status,
        started.toISOString().slice(0, 10),
        finished.toISOString().slice(0, 10),
        days,
      ])
    }

    if (counted > 0) {
      sheet.addRow([])
      sheet.addRow(['Average calendar days', '', '', '', '', Math.round(totalDays / counted)])
    }
    sheet.columns.forEach((c) => (c.width = 22))

    return this.finalize(
      actor,
      companyId,
      REG_DOSSIER_TURNAROUND_REPORT_TYPE_KEY,
      'Dossier Turnaround-Time Analytics',
      await bufferOf(workbook),
      meta,
      {
        dossierCount: counted,
        averageDays: counted > 0 ? Math.round(totalDays / counted) : null,
      },
    )
  }

  private async finalize(
    actor: AuthenticatedUser,
    companyId: string,
    reportTypeKey: string,
    title: string,
    buffer: Buffer,
    meta: RequestMeta,
    auditDetail: Record<string, unknown>,
  ): Promise<GeneratedReport> {
    const reportId = newId()
    const file: DirectUploadFile = {
      buffer,
      originalname: `${reportTypeKey}.xlsx`,
      mimetype: XLSX_CONTENT_TYPE,
    }
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      file,
      { title },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'regcloud',
          reportTypeKey,
          title,
          status: 'final',
          generatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: `${reportTypeKey}_generated`,
        recordType: 'generated_report',
        recordId: created.id,
        newValue: auditDetail,
        ip: meta.ip,
      })

      return created
    })
  }
}
