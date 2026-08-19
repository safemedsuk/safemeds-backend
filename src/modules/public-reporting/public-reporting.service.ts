import { Injectable, NotFoundException } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { MailService } from '../auth/services/mail.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { resolveDefaultReportType } from '../pv/default-report-type.util'
import { CreatePvCaseDto } from '../pv/dto/create-pv-case.dto'
import { PvCaseService } from '../pv/pv-case.service'
import { SourceDocumentService } from '../pv/source-document.service'
import { SubmitPublicReportDto } from './dto/submit-public-report.dto'

export interface RequestMeta {
  ip?: string
}

export interface PublicCompanyDisplay {
  companyName: string
  /** Stage 3.1 — the report type every submission through this form will be filed as, shown to the reporter in plain language before they submit. Null only if the company has no PV report type configured at all (submit will then also fail). */
  reportTypeName: string | null
}

export interface PublicSubmissionResult {
  referenceNumber: string
}

/**
 * VigiCloud testing-todo Stage 3.2 — a public-safe, narrow projection of
 * `Product`. Deliberately excludes everything internal (`companyId`,
 * `isActive`, cost/pack-size/manufacturing-site fields) — an anonymous
 * reporter only ever needs enough to recognize and pick the right
 * product, matching exactly what the row-prefill on selection actually
 * uses.
 */
export interface PublicProductResult {
  id: string
  brandName: string
  genericName: string
  innName: string | null
  atcCode: string | null
  dosageForm: string
  strength: string
}

/**
 * VigiCloud Stage 3.2 — the per-company public case-reporting URL
 * (`{FRONTEND_URL}/report/{slug}`). No authentication at all — resolves
 * the tenant purely from the slug, via `RlsService.runWithSystemAccess()`
 * (the same "identity not established yet" pattern login/registration
 * use), then hands off to `PvCaseService.createFromSystemChannel()` —
 * exactly the same shared graph-creation path Stage 3.3 (email) and 3.4
 * (WhatsApp) use, so a public submission gets the identical
 * `requiresDraftReview: true` human-confirmation guarantee.
 */
@Injectable()
export class PublicReportingService {
  constructor(
    private readonly rls: RlsService,
    private readonly pvCaseService: PvCaseService,
    private readonly mailService: MailService,
    private readonly documentsService: DocumentsService,
    private readonly sourceDocumentService: SourceDocumentService,
  ) {}

  async resolveCompanyDisplay(slug: string): Promise<PublicCompanyDisplay> {
    const company = await this.findActiveCompanyBySlug(slug)
    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    return { companyName: company.name, reportTypeName: reportType?.name ?? null }
  }

  async submit(
    slug: string,
    dto: SubmitPublicReportDto,
    meta: RequestMeta,
  ): Promise<PublicSubmissionResult> {
    const company = await this.findActiveCompanyBySlug(slug)

    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    if (!reportType) {
      throw new NotFoundException({
        code: 'NOT_CONFIGURED',
        message: 'No PV report type is configured for this company yet',
      })
    }

    const today = new Date().toISOString().slice(0, 10)
    const fullDto: CreatePvCaseDto = {
      reportTypeId: reportType.id,
      countryOfOccurrenceId: company.homeCountryId,
      countryOfReportId: company.homeCountryId,
      awarenessDate: today,
      receivedDate: today,
      reporter: dto.reporter,
      patient: dto.patient,
      suspectProducts: dto.suspectProducts,
      adverseEvents: dto.adverseEvents,
      consent: dto.consent,
      suspectedFalsifiedOrSubstandard: dto.suspectedFalsifiedOrSubstandard,
      pregnancy: dto.pregnancy,
    }

    const created = await this.pvCaseService.createFromSystemChannel(
      company.id,
      fullDto,
      'public_url',
      null,
      meta,
    )

    // Stage 3.3 — best-effort (MailService.send() never throws), and only
    // possible if the reporter actually gave an email address; the UI's
    // own on-screen confirmation is the guaranteed fallback either way.
    if (dto.reporter.email) {
      await this.mailService.sendCaseReceivedConfirmation(
        dto.reporter.email,
        company.name,
        created.referenceNumber,
      )
    }

    return { referenceNumber: created.referenceNumber }
  }

  /**
   * VigiCloud testing-todo Stage 3.2 — lets the public reporting form
   * reuse the same "search the company's own product catalog" experience
   * the authenticated case wizard's `ProductPicker` already offers,
   * instead of forcing a free-text-only product field on an anonymous
   * reporter. Capped at 8 results and requires ≥2 characters, matching
   * `ProductPicker`'s own debounced-search shape exactly.
   */
  async searchProducts(slug: string, q: string): Promise<PublicProductResult[]> {
    const company = await this.findActiveCompanyBySlug(slug)
    const query = q?.trim() ?? ''
    if (query.length < 2) return []

    const rows = await this.rls.runWithSystemAccess((tx) =>
      tx.product.findMany({
        where: {
          companyId: company.id,
          isActive: true,
          OR: [
            { brandName: { contains: query, mode: 'insensitive' } },
            { genericName: { contains: query, mode: 'insensitive' } },
            { innName: { contains: query, mode: 'insensitive' } },
            { atcCode: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { brandName: 'asc' },
        take: 8,
      }),
    )

    return rows.map((p) => ({
      id: p.id,
      brandName: p.brandName,
      genericName: p.genericName,
      innName: p.innName,
      atcCode: p.atcCode,
      dosageForm: p.dosageForm,
      strength: p.strength,
    }))
  }

  /**
   * VigiCloud testing-todo Stage 3.4 — an optional, post-submission
   * attachment step: the public form shows the confirmation screen with
   * the real reference number first, then lets the reporter attach a
   * source document (packaging photo, pharmacy receipt, discharge note)
   * against that specific case. Scoped by the same `(slug,
   * referenceNumber)` pair already shown on-screen to the reporter — not
   * the internal case UUID, which is never exposed over this API —
   * mirroring `WhatsAppChatbotService.attachPhoto()`'s own
   * `uploadDirectSystem()` + `linkSystem()` pairing exactly, since both
   * are the same "no authenticated actor, but a real case to attach
   * evidence to" situation.
   */
  async attachSourceDocument(
    slug: string,
    referenceNumber: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<{ attached: boolean }> {
    const company = await this.findActiveCompanyBySlug(slug)
    const pvCase = await this.rls.runWithSystemAccess((tx) =>
      tx.case.findFirst({ where: { companyId: company.id, referenceNumber } }),
    )
    if (!pvCase) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No report found with that reference number',
      })
    }

    const { document } = await this.documentsService.uploadDirectSystem(
      company.id,
      'pv_case',
      pvCase.id,
      file,
      { title: 'Source document (public report)' },
      meta,
    )
    await this.sourceDocumentService.linkSystem(company.id, pvCase.id, document.id, meta)
    return { attached: true }
  }

  private async findActiveCompanyBySlug(slug: string) {
    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findFirst({ where: { publicReportingSlug: slug, status: 'active' } }),
    )
    if (!company) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'This reporting link is not valid',
      })
    }
    return company
  }
}
