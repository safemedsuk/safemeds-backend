import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { GeneratedReport } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { WorkflowService } from '../workflow/workflow.service'
import { BenefitRiskService, BenefitRiskSummary } from './benefit-risk.service'
import { GeneratePeriodicReportDto } from './dto/generate-periodic-report.dto'
import { computeNextEurdPeriod, isEurdPeriodReady } from './eurd-cadence.util'
import { PeriodicReportPdfService } from './periodic-report-pdf.service'
import { PERIODIC_REPORT_RECORD_TYPE } from './periodic-report-workflow-guards.service'

export interface RequestMeta {
  ip?: string
}

export interface PeriodicReportWithSummary extends GeneratedReport {
  benefitRisk: BenefitRiskSummary
  /** The real `periodic_report` `WorkflowInstance` id driving this report's review/sign-off/submit lifecycle — null only if `instantiate()` somehow failed, mirroring `PvCase.workflowInstanceId`'s own doc comment. */
  workflowInstanceId: string | null
}

const REPORT_LABELS: Record<GeneratePeriodicReportDto['reportTypeKey'], string> = {
  psur: 'Periodic Safety Update Report (PSUR)',
  pbrer: 'Periodic Benefit-Risk Evaluation Report (PBRER)',
  dsur: 'Development Safety Update Report (DSUR)',
  pader: 'Periodic Adverse Drug Experience Report (PADER)',
  cioms_ii: 'CIOMS II Periodic Line Listing',
}

/** psur/pbrer are built against GUD/022 §6.2's confirmed EURD-style cadence; the other three have no confirmed periodicity source and are on-demand/custom-range only. */
const AUTO_CADENCE_TYPES: ReadonlySet<GeneratePeriodicReportDto['reportTypeKey']> = new Set([
  'psur',
  'pbrer',
])

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A periodic report is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 18 — PSUR/PBRER/DSUR/PADER/CIOMS-II generation.
 * PSUR/PBRER periodicity is genuinely confirmed (GUD/022 §6.2, the same
 * source already backing CLAUDE.md's own domain-knowledge notes on this
 * cadence) — `EurdCadenceUtil` computes the next Data Lock Point and
 * submission deadline automatically from `Product.internationalBirthDate`,
 * the same way `RuleResolutionService` resolves an incident deadline
 * automatically rather than asking a human to compute it by hand. DSUR/
 * PADER/CIOMS II have no equivalently confirmed periodicity source, so
 * this service deliberately requires an explicit period for those three
 * rather than guessing a cadence — the honest-degradation precedent
 * `TriageService.deadlineUnavailable` and `RuleResolutionService`'s own
 * null-for-foreign-cases already established in this codebase, applied
 * here to "we don't know this cadence" instead of "we don't have this
 * rule yet." Cumulative safety data comes from `BenefitRiskService`
 * verbatim; sales/exposure data is explicitly out of this build's scope
 * (the build spec's own text: "the report generator accepts it as an
 * input, doesn't source it") — there is no sales-data field anywhere in
 * this service because nothing upstream produces one yet.
 *
 * Real-usage request, 11 Sep 2026 — "Periodic and aggregate reports...
 * as proper workflows (data-lock point, generate, review, QPPV
 * sign-off, submit, evidence)." `generate()` now lands at `draft`, not
 * `final` — a real `periodic_report` `WorkflowInstance` (see
 * `periodic-report-workflow-guards.service.ts`) drives review (QC) and
 * sign-off+submit from there, the same generic engine every other
 * multi-step record type in this codebase already uses. The generic
 * `ReportsService.finalize()`/`.submit()` single-click actions are
 * blocked for a report with a `periodic_report` instance — see that
 * service's own doc comment.
 */
@Injectable()
export class PeriodicReportService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
    private readonly workflowService: WorkflowService,
    private readonly pdfService: PeriodicReportPdfService,
    private readonly benefitRiskService: BenefitRiskService,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    dto: GeneratePeriodicReportDto,
    meta: RequestMeta,
  ): Promise<PeriodicReportWithSummary> {
    const companyId = requireCompany(actor)
    const isTrialBased = dto.reportTypeKey === 'dsur'

    if (isTrialBased && !dto.clinicalTrialId) {
      throw new BadRequestException({
        code: 'CLINICAL_TRIAL_REQUIRED',
        message: 'A DSUR requires clinicalTrialId',
      })
    }
    if (!isTrialBased && !dto.productId) {
      throw new BadRequestException({
        code: 'PRODUCT_REQUIRED',
        message: `A ${dto.reportTypeKey.toUpperCase()} requires productId`,
      })
    }
    if (!AUTO_CADENCE_TYPES.has(dto.reportTypeKey) && !(dto.periodStart && dto.periodEnd)) {
      throw new BadRequestException({
        code: 'PERIOD_REQUIRED',
        message: `${REPORT_LABELS[dto.reportTypeKey]} has no confirmed automatic cadence — supply periodStart and periodEnd explicitly`,
      })
    }

    const prepared = await this.rls.runAsCompany(companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } })

      let subjectName: string
      let recordType: 'product' | 'clinical_trial'
      let recordId: string
      let periodStart: Date
      let periodEnd: Date
      let dueAt: Date | null
      let productDetail: {
        innName: string | null
        genericName: string | null
        atcCode: string | null
        dosageForm: string | null
        strength: string | null
        routeOfAdministration: string | null
        internationalBirthDate: Date | null
      } | null = null

      if (isTrialBased) {
        const trial = await tx.clinicalTrial.findFirst({
          where: { id: dto.clinicalTrialId!, companyId },
        })
        if (!trial) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
        }
        subjectName = trial.trialName
        recordType = 'clinical_trial'
        recordId = trial.id
        periodStart = new Date(dto.periodStart!)
        periodEnd = new Date(dto.periodEnd!)
        dueAt = null
      } else {
        const product = await tx.product.findFirst({ where: { id: dto.productId!, companyId } })
        if (!product) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })
        }
        subjectName = product.brandName
        recordType = 'product'
        recordId = product.id
        productDetail = {
          innName: product.innName,
          genericName: product.genericName,
          atcCode: product.atcCode,
          dosageForm: product.dosageForm,
          strength: product.strength,
          routeOfAdministration: product.routeOfAdministration,
          internationalBirthDate: product.internationalBirthDate,
        }

        if (AUTO_CADENCE_TYPES.has(dto.reportTypeKey) && !(dto.periodStart && dto.periodEnd)) {
          if (!product.internationalBirthDate) {
            throw new ConflictException({
              code: 'INTERNATIONAL_BIRTH_DATE_REQUIRED',
              message:
                'This product has no international birth date set — required to compute the EURD-cadence period automatically',
            })
          }
          const previous = await tx.generatedReport.findFirst({
            where: {
              companyId,
              moduleKey: 'pv',
              reportTypeKey: dto.reportTypeKey,
              recordType: 'product',
              recordId: product.id,
            },
            orderBy: { periodEnd: 'desc' },
          })
          const period = computeNextEurdPeriod(
            product.internationalBirthDate,
            previous?.periodEnd ?? null,
          )
          if (!isEurdPeriodReady(period, new Date())) {
            throw new ConflictException({
              code: 'DATA_LOCK_POINT_NOT_REACHED',
              message: `The next ${dto.reportTypeKey.toUpperCase()} period's Data Lock Point (${period.periodEnd.toISOString().slice(0, 10)}) has not been reached yet`,
            })
          }
          periodStart = period.periodStart
          periodEnd = period.periodEnd
          dueAt = period.dueAt
        } else {
          periodStart = new Date(dto.periodStart!)
          periodEnd = new Date(dto.periodEnd!)
          dueAt = null
        }
      }

      const benefitRisk = isTrialBased
        ? await this.benefitRiskService.computeSummaryForTrial(
            tx,
            companyId,
            recordId,
            periodStart,
            periodEnd,
          )
        : await this.benefitRiskService.computeSummary(
            tx,
            companyId,
            recordId,
            periodStart,
            periodEnd,
          )

      // Real-document-fidelity request, 12 Sep 2026 — a real per-case line
      // listing (CIOMS II's own defining feature; also used as PADER's
      // §5) and a real open-signal count (PSUR/PBRER §15, DSUR §12) —
      // both genuinely computed, never fabricated.
      const caseWhere = isTrialBased
        ? {
            companyId,
            duplicateOfCaseId: null,
            clinicalTrialId: recordId,
            ...(periodStart && periodEnd
              ? { awarenessDate: { gte: periodStart, lte: periodEnd } }
              : {}),
          }
        : {
            companyId,
            duplicateOfCaseId: null,
            suspectProducts: { some: { productId: recordId } },
            ...(periodStart && periodEnd
              ? { awarenessDate: { gte: periodStart, lte: periodEnd } }
              : {}),
          }
      const caseRows = await tx.case.findMany({
        where: caseWhere,
        select: {
          referenceNumber: true,
          seriousnessClass: true,
          countryOfOccurrence: { select: { name: true } },
          patient: { select: { ageYears: true, sex: true } },
          adverseEvents: { select: { reportedTerm: true, outcome: true } },
          suspectProducts: {
            where: isTrialBased ? undefined : { productId: recordId },
            select: {
              medicinalProduct: true,
              causalityAssessments: { select: { whoUmcCategory: true } },
            },
          },
        },
        take: 200,
      })
      const caseListing = caseRows.map((c) => ({
        referenceNumber: c.referenceNumber,
        countryName: c.countryOfOccurrence?.name ?? 'Unknown',
        ageYears: c.patient?.ageYears ?? null,
        sex: c.patient?.sex ?? 'unknown',
        suspectProduct: c.suspectProducts[0]?.medicinalProduct ?? subjectName,
        reactions: c.adverseEvents.map((ae) => ae.reportedTerm),
        outcome: c.adverseEvents[0]?.outcome ?? 'unknown',
        seriousnessClass: c.seriousnessClass,
        causality:
          c.suspectProducts
            .flatMap((sp) => sp.causalityAssessments.map((ca) => ca.whoUmcCategory))
            .find((c2) => c2) ?? null,
      }))

      const openSignalsCount = await tx.signal.count({
        where: isTrialBased
          ? {
              companyId,
              status: {
                notIn: ['non_validated', 'not_confirmed', 'action_recommended', 'refuted'],
              },
            }
          : {
              companyId,
              productId: recordId,
              status: {
                notIn: ['non_validated', 'not_confirmed', 'action_recommended', 'refuted'],
              },
            },
      })

      return {
        companyName: company.name,
        companyAddress: company.registeredAddress,
        regulatoryContactEmail: company.regulatoryContactEmail,
        regulatoryContactPhone: company.regulatoryContactPhone,
        subjectName,
        recordType,
        recordId,
        periodStart,
        periodEnd,
        dueAt,
        benefitRisk,
        productDetail,
        caseListing,
        openSignalsCount,
      }
    })

    const generatedAt = new Date()
    const pdf = await this.pdfService.render({
      reportTypeKey: dto.reportTypeKey,
      reportTypeLabel: REPORT_LABELS[dto.reportTypeKey],
      companyName: prepared.companyName,
      companyAddress: prepared.companyAddress,
      regulatoryContactEmail: prepared.regulatoryContactEmail,
      regulatoryContactPhone: prepared.regulatoryContactPhone,
      subjectName: prepared.subjectName,
      isTrialBased,
      innName: prepared.productDetail?.innName ?? null,
      genericName: prepared.productDetail?.genericName ?? null,
      atcCode: prepared.productDetail?.atcCode ?? null,
      dosageForm: prepared.productDetail?.dosageForm ?? null,
      strength: prepared.productDetail?.strength ?? null,
      routeOfAdministration: prepared.productDetail?.routeOfAdministration ?? null,
      internationalBirthDate: prepared.productDetail?.internationalBirthDate ?? null,
      periodStart: prepared.periodStart,
      periodEnd: prepared.periodEnd,
      dueAt: prepared.dueAt,
      generatedAt,
      benefitRisk: prepared.benefitRisk,
      openSignalsCount: prepared.openSignalsCount,
      conclusionNote: dto.conclusionNote ?? null,
      actionsTakenForSafety: dto.actionsTakenForSafety ?? null,
      changesToReferenceSafetyInfo: dto.changesToReferenceSafetyInfo ?? null,
      estimatedExposure: dto.estimatedExposure ?? null,
      caseListing: prepared.caseListing,
    })

    const reportId = newId()
    const file: DirectUploadFile = {
      buffer: pdf,
      originalname: `${dto.reportTypeKey}.pdf`,
      mimetype: 'application/pdf',
    }
    await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      reportId,
      file,
      { title: REPORT_LABELS[dto.reportTypeKey] },
      meta,
    )

    const report = await this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: 'pv',
          reportTypeKey: dto.reportTypeKey,
          title: `${REPORT_LABELS[dto.reportTypeKey]} — ${prepared.subjectName}`,
          periodStart: prepared.periodStart,
          periodEnd: prepared.periodEnd,
          recordType: prepared.recordType,
          recordId: prepared.recordId,
          status: 'draft',
          dueAt: prepared.dueAt,
          generatedBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'periodic_report_generated',
        recordType: 'generated_report',
        recordId: created.id,
        newValue: {
          reportTypeKey: dto.reportTypeKey,
          subject: prepared.subjectName,
          periodStart: prepared.periodStart,
          periodEnd: prepared.periodEnd,
          caseCount: prepared.benefitRisk.caseCount,
        },
        ip: meta.ip,
      })

      return created
    })

    // Sequential, not nested — matches `PvCaseService.create()`'s own
    // established precedent for calling `workflowService.instantiate()`
    // only after the entity's own creation transaction has committed.
    const instance = await this.workflowService.instantiate(
      actor,
      PERIODIC_REPORT_RECORD_TYPE,
      report.id,
      null,
      meta,
    )

    return { ...report, workflowInstanceId: instance.id, benefitRisk: prepared.benefitRisk }
  }

  /**
   * The "attach proof it was actually dispatched" step — a portal
   * confirmation, an email receipt. Deliberately ungated (no
   * transition requires this) — see this class's own doc comment for
   * why a periodic report has no live-gateway evidence gate the way
   * `RegulatorySubmissionService.attachEvidence()`'s E2B evidence does.
   */
  async attachEvidence(
    actor: AuthenticatedUser,
    id: string,
    file: DirectUploadFile,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)

    const report = await this.rls.runAsCompany(companyId, (tx) =>
      tx.generatedReport.findFirst({ where: { id, companyId } }),
    )
    if (!report) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report not found' })

    // Same reasoning as `generate()` — the real R2 upload is slow,
    // network-bound work that doesn't need a DB transaction held open
    // around it.
    const upload = await this.documentsService.uploadDirect(
      actor,
      'generated_report',
      id,
      file,
      { title: 'Submission Evidence' },
      meta,
    )

    return this.rls.runAsCompany(companyId, async (tx) => {
      const updated = await tx.generatedReport.update({
        where: { id },
        data: { evidenceDocumentId: upload.document.id },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'periodic_report_evidence_attached',
        recordType: 'generated_report',
        recordId: id,
        newValue: { evidenceDocumentId: upload.document.id },
        ip: meta.ip,
      })

      return updated
    })
  }
}
