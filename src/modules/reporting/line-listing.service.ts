import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { GeneratedReport, Prisma } from '@prisma/client'
import ExcelJS from 'exceljs'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { GenerateLineListingDto } from './dto/generate-line-listing.dto'

export interface RequestMeta {
  ip?: string
}

export const LINE_LISTING_REPORT_TYPE_KEY = 'line_listing'

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A line listing is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

async function buildWorkbook(
  companyName: string,
  countryName: string,
  periodStart: Date,
  periodEnd: Date,
  cases: LineListingCaseRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Line Listing')
  sheet.addRow([`${companyName} — Line Listing — ${countryName}`])
  sheet.addRow([
    `Period: ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
  ])
  sheet.addRow([])

  const headerRow = sheet.addRow([
    'Reference',
    'Report Type',
    'Awareness Date',
    'Seriousness',
    'Suspect Product(s)',
    'Reaction(s)',
  ])
  headerRow.font = { bold: true }

  for (const c of cases) {
    sheet.addRow([
      c.referenceNumber,
      c.reportTypeName,
      c.awarenessDate.toISOString().slice(0, 10),
      c.seriousnessClass ?? 'not assessed',
      c.products.join('; '),
      c.reactions.join('; '),
    ])
  }

  sheet.columns.forEach((column) => {
    column.width = 24
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

interface LineListingCaseRow {
  referenceNumber: string
  reportTypeName: string
  awarenessDate: Date
  seriousnessClass: string | null
  products: string[]
  reactions: string[]
}

/**
 * VigiCloud Stage 18 — line listings, both on-demand (an explicit
 * `periodStart`/`periodEnd`) and on the country's own configured cadence
 * (Stage 0.11's `ReportingRule.reportingPeriodDays`, resolved through a
 * `line_listing`-typed `ReportType` — see `country-rules.seed-data.ts`'s
 * own doc comment for why this needed no separate schema). Real Excel
 * output via `exceljs`, a genuinely new backend dependency — the
 * existing frontend `xlsx` package is a browser-side reader only (Stage
 * 2's bulk-import flow), nothing in this codebase wrote a `.xlsx` file
 * server-side before this stage. `scanAndAutoGenerate()` (used by
 * `LineListingScheduleProcessor`) is deliberately scoped to each
 * company's own `homeCountryId` only — a genuinely simpler model than a
 * full per-country subscription list, which nothing in this build
 * defines yet; a multi-country line-listing obligation still works, it
 * just has to be triggered on-demand per country rather than
 * auto-scheduled for every country a tenant happens to operate in.
 */
@Injectable()
export class LineListingService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    dto: GenerateLineListingDto,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)
    return this.generateInternal(companyId, actor, dto, meta)
  }

  private async generateInternal(
    companyId: string,
    actor: AuthenticatedUser | null,
    dto: GenerateLineListingDto,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const prepared = await this.rls.runAsCompany(companyId, async (tx) => {
      const country = await tx.country.findUniqueOrThrow({ where: { id: dto.countryId } })
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })

      let periodStart: Date
      let periodEnd: Date
      let dueAt: Date

      if (dto.periodStart && dto.periodEnd) {
        periodStart = new Date(dto.periodStart)
        periodEnd = new Date(dto.periodEnd)
        dueAt = periodEnd
      } else {
        const rule = await tx.reportingRule.findFirst({
          where: {
            reportType: { typeKey: LINE_LISTING_REPORT_TYPE_KEY },
            authority: { countryId: dto.countryId },
            status: 'active',
          },
        })
        if (!rule || !rule.reportingPeriodDays) {
          throw new ConflictException({
            code: 'NO_CADENCE_CONFIGURED',
            message:
              'No active line-listing cadence is configured for this country — supply an explicit period instead',
          })
        }

        const previous = await tx.generatedReport.findFirst({
          where: {
            companyId,
            moduleKey: 'pv',
            reportTypeKey: LINE_LISTING_REPORT_TYPE_KEY,
            recordType: 'country',
            recordId: dto.countryId,
          },
          orderBy: { periodEnd: 'desc' },
        })
        periodStart = previous?.periodEnd ?? addDays(new Date(), -rule.reportingPeriodDays)
        periodEnd = addDays(periodStart, rule.reportingPeriodDays)
        dueAt = periodEnd

        if (periodEnd.getTime() > Date.now()) {
          throw new ConflictException({
            code: 'PERIOD_NOT_ELAPSED',
            message: `The next line-listing period (ending ${periodEnd.toISOString().slice(0, 10)}) has not elapsed yet`,
          })
        }
      }

      const cases = await this.fetchCases(tx, companyId, dto.countryId, periodStart, periodEnd)

      return {
        companyName: company.name,
        countryName: country.name,
        periodStart,
        periodEnd,
        dueAt,
        cases,
      }
    })

    const workbookBuffer = await buildWorkbook(
      prepared.companyName,
      prepared.countryName,
      prepared.periodStart,
      prepared.periodEnd,
      prepared.cases,
    )

    const reportId = newId()
    const file: DirectUploadFile = {
      buffer: workbookBuffer,
      originalname: 'line-listing.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
    if (actor) {
      await this.documentsService.uploadDirect(
        actor,
        'generated_report',
        reportId,
        file,
        { title: `Line Listing — ${prepared.countryName}` },
        meta,
      )
    } else {
      await this.documentsService.uploadDirectSystem(
        companyId,
        'generated_report',
        reportId,
        file,
        { title: `Line Listing — ${prepared.countryName}` },
        meta,
      )
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'pv',
          reportTypeKey: LINE_LISTING_REPORT_TYPE_KEY,
          title: `Line Listing — ${prepared.countryName} — ${prepared.periodStart.toISOString().slice(0, 10)} to ${prepared.periodEnd.toISOString().slice(0, 10)}`,
          periodStart: prepared.periodStart,
          periodEnd: prepared.periodEnd,
          recordType: 'country',
          recordId: dto.countryId,
          status: 'final',
          dueAt: prepared.dueAt,
          generatedBy: actor?.sub ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor?.sub ?? null,
        action: 'line_listing_generated',
        recordType: 'generated_report',
        recordId: created.id,
        newValue: {
          countryId: dto.countryId,
          periodStart: prepared.periodStart,
          periodEnd: prepared.periodEnd,
          caseCount: prepared.cases.length,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  /** Auto-generates a due line listing for every company's own home country, if that country has a configured cadence and the period has elapsed. Called by `LineListingScheduleProcessor`. */
  async scanAllCompanies(): Promise<{ generated: number }> {
    let generated = 0

    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({
        where: { status: 'active' },
        select: { id: true, homeCountryId: true },
      }),
    )

    for (const company of companies) {
      try {
        await this.generateInternal(company.id, null, { countryId: company.homeCountryId }, {})
        generated += 1
      } catch {
        // Best-effort — a company with no configured cadence, or whose period hasn't elapsed, is normal and not an error worth interrupting the scan for.
      }
    }

    return { generated }
  }

  private async fetchCases(
    tx: Prisma.TransactionClient,
    companyId: string,
    countryId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LineListingCaseRow[]> {
    const cases = await tx.case.findMany({
      where: {
        companyId,
        countryOfOccurrenceId: countryId,
        duplicateOfCaseId: null,
        awarenessDate: { gte: periodStart, lte: periodEnd },
      },
      select: {
        referenceNumber: true,
        awarenessDate: true,
        seriousnessClass: true,
        reportType: { select: { name: true } },
        suspectProducts: { select: { medicinalProduct: true } },
        adverseEvents: { select: { reportedTerm: true } },
      },
      orderBy: { awarenessDate: 'asc' },
    })

    return cases.map((c) => ({
      referenceNumber: c.referenceNumber,
      reportTypeName: c.reportType.name,
      awarenessDate: c.awarenessDate,
      seriousnessClass: c.seriousnessClass,
      products: c.suspectProducts.map((sp) => sp.medicinalProduct),
      reactions: c.adverseEvents.map((ae) => ae.reportedTerm),
    }))
  }
}
