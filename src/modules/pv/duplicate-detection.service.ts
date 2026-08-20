import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Case, DuplicateReview, Patient, PatientSex, Prisma } from '@prisma/client'
import { randomInt } from 'crypto'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RecordVersioningService } from '../record-versioning/record-versioning.service'
import { WorkflowService } from '../workflow/workflow.service'
import { ConfirmDuplicateDto } from './dto/confirm-duplicate.dto'
import { DismissDuplicateDto } from './dto/dismiss-duplicate.dto'
import { PV_CASE_RECORD_TYPE, RequestMeta } from './pv-case.service'

export const PV_DUPLICATE_REVIEW_RECORD_TYPE = 'pv_duplicate_review'

/**
 * The EMA guideline's own "strong initial filter" (country, sex, age
 * grouping) is deliberately coarse — an exact age match would miss real
 * duplicates reported with slightly different ages (a common real-world
 * transcription variance), so this tolerates a small spread either way
 * before falling through to the product/reaction similarity check.
 */
const AGE_TOLERANCE_YEARS = 2

interface CandidatePatient {
  sex: PatientSex
  ageYears: number | null
  dateOfBirth: Date | null
}

interface CandidateCase {
  id: string
  countryOfOccurrenceId: string
  awarenessDate: Date
  patient: CandidatePatient | null
  productTerms: string[]
  reactionTerms: string[]
}

export interface DuplicateMatchedFields {
  citedReferenceNumber?: true
  country?: true
  sex?: true
  age?: true
  products?: string[]
  reactions?: string[]
}

export interface DuplicateMatch {
  matchedCaseId: string
  matchedFields: DuplicateMatchedFields
}

function resolveAgeYears(patient: CandidatePatient, asOf: Date): number | null {
  if (patient.ageYears !== null) return patient.ageYears
  if (patient.dateOfBirth) {
    const ms = asOf.getTime() - patient.dateOfBirth.getTime()
    return ms >= 0 ? Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000)) : null
  }
  return null
}

/** Significant words only (≥4 characters) — drops short connector/unit tokens ("mg", "of", "the") that would otherwise produce false-positive word overlaps between two genuinely unrelated terms. */
function significantWords(term: string): Set<string> {
  return new Set(
    term
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  )
}

/**
 * Case-insensitive term overlap, checked two ways: a substring match (the
 * same product/reaction often carries slightly different casing or
 * trailing detail — "Depo-Provera" vs "depo-provera 150mg injection")
 * *and* a shared-significant-word match, independent of word order — a
 * clinician's "Headache, severe" and a patient's own "Severe headache"
 * describe the exact same reaction but share no substring relationship at
 * all. Neither check alone is enough; requiring only one of the two to
 * fire keeps both real-world phrasing patterns covered.
 */
function overlappingTerms(a: string[], b: string[]): string[] {
  const matches = new Set<string>()
  for (const termA of a) {
    const normA = termA.trim().toLowerCase()
    if (!normA) continue
    const wordsA = significantWords(termA)
    for (const termB of b) {
      const normB = termB.trim().toLowerCase()
      if (!normB) continue
      const substringMatch = normA === normB || normA.includes(normB) || normB.includes(normA)
      const wordOverlap = wordsA.size > 0 && [...wordsA].some((w) => significantWords(termB).has(w))
      if (substringMatch || wordOverlap) {
        matches.add(termA)
      }
    }
  }
  return [...matches]
}

/**
 * Pure — the EMA guideline's detection algorithm itself, kept independent
 * of Prisma/RLS so it's directly unit-testable against plain fixtures.
 * Country + sex + age are the "strong initial filter" (per the guideline's
 * own recommended search fields); a case only becomes a "possible
 * duplicate" if it *also* clears the filter AND shares at least one
 * suspect product term AND at least one adverse-event term with the
 * target — either signal alone is treated as too weak (two different
 * patients of similar age in the same country reporting completely
 * unrelated drugs/reactions is not a duplicate signal).
 */
export function findSimilarityMatch(
  target: CandidateCase,
  candidate: CandidateCase,
): DuplicateMatch | null {
  if (target.countryOfOccurrenceId !== candidate.countryOfOccurrenceId) return null
  if (!target.patient || !candidate.patient) return null

  const sexKnown = target.patient.sex !== 'unknown' && candidate.patient.sex !== 'unknown'
  if (sexKnown && target.patient.sex !== candidate.patient.sex) return null

  const targetAge = resolveAgeYears(target.patient, target.awarenessDate)
  const candidateAge = resolveAgeYears(candidate.patient, candidate.awarenessDate)
  if (
    targetAge === null ||
    candidateAge === null ||
    Math.abs(targetAge - candidateAge) > AGE_TOLERANCE_YEARS
  )
    return null

  const products = overlappingTerms(target.productTerms, candidate.productTerms)
  const reactions = overlappingTerms(target.reactionTerms, candidate.reactionTerms)
  if (products.length === 0 || reactions.length === 0) return null

  return {
    matchedCaseId: candidate.id,
    matchedFields: {
      country: true,
      ...(sexKnown ? { sex: true } : {}),
      age: true,
      products,
      reactions,
    },
  }
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'PV cases are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

type ReviewWithCases = DuplicateReview & {
  case: Pick<Case, 'id' | 'referenceNumber'>
  matchedCase: Pick<Case, 'id' | 'referenceNumber'>
}
type ReviewWithDecrypted = Omit<ReviewWithCases, 'reviewNoteEncrypted'> & {
  reviewNote: string | null
}

/**
 * VigiCloud Stage 10 — built against the real EMA Guideline on Detection
 * and Management of Duplicate ICSRs (`vigicloud docs/EMA draft-guideline-
 * detection-and-management-duplicate...pdf`), whose "Master Case"
 * terminology this service uses throughout. Detection always only ever
 * proposes a `DuplicateReview` at `status: possible` — confirmation is a
 * deliberate, always-manual human decision (`confirmDuplicate()`/
 * `dismissDuplicate()`), matching the guideline's explicit two-step
 * detection→confirmation split; nothing in this service ever writes
 * `Case.duplicateOfCaseId` on its own.
 *
 * Both of the guideline's Master Case patterns are implemented through
 * the single, already-existing `Case.duplicateOfCaseId` field — see that
 * column's own schema doc comment for why a second "MasterCaseId group"
 * mechanism (as an earlier planning pass assumed) turned out to be
 * unnecessary: Allocation points it at an *existing* case
 * (`markSubordinate()` alone); Creation first synthesizes a brand-new
 * `Case` row to be the master (`createMasterCase()`), then does the same
 * `markSubordinate()` on both original cases.
 */
@Injectable()
export class DuplicateDetectionService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly textEncryption: TextEncryptionService,
    private readonly recordVersioningService: RecordVersioningService,
    private readonly workflowService: WorkflowService,
  ) {}

  /**
   * Runs inside the caller's already-open transaction — called by
   * `PvCaseService` immediately after a new case's graph is built, and by
   * `scanOpenCases()`'s own per-company transaction for the periodic
   * re-screen. `citedCaseReferenceNumber` (only ever passed at creation
   * time — it's an intake-time hint, not a stored case field) short-
   * circuits straight to that specific case, skipping the fuzzy filter
   * entirely, per the todo doc's own "should short-circuit... not run the
   * fuzzy search at all" instruction — it still only ever produces a
   * `possible` review, never an auto-confirm.
   */
  async screenInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    citedCaseReferenceNumber?: string | null,
  ): Promise<DuplicateReview[]> {
    const target = await this.loadCandidate(tx, companyId, caseId)
    if (!target) return []

    const touched: DuplicateReview[] = []

    if (citedCaseReferenceNumber) {
      const cited = await tx.case.findFirst({
        where: { companyId, referenceNumber: citedCaseReferenceNumber, id: { not: caseId } },
      })
      if (cited) {
        touched.push(
          await this.upsertReview(tx, companyId, caseId, cited.id, { citedReferenceNumber: true }),
        )
      }
    }

    const openCases = await tx.case.findMany({
      where: {
        companyId,
        id: { not: caseId },
        duplicateOfCaseId: null,
        countryOfOccurrenceId: target.countryOfOccurrenceId,
      },
      include: { patient: true, suspectProducts: true, adverseEvents: true },
    })

    for (const row of openCases) {
      if (touched.some((r) => r.matchedCaseId === row.id)) continue
      const candidate = this.toCandidate(row, row.patient, row.suspectProducts, row.adverseEvents)
      const match = findSimilarityMatch(target, candidate)
      if (match) {
        touched.push(
          await this.upsertReview(tx, companyId, caseId, match.matchedCaseId, match.matchedFields),
        )
      }
    }

    return touched
  }

  /**
   * The periodic re-screen — the EMA guideline's recommended cadence is
   * daily; reuses the exact per-company `runWithSystemAccess` (list
   * companies) → `runAsCompany` (scan) shape already established by
   * `ProductReviewReminderService`, not a new pattern. Only cases still
   * open (`duplicateOfCaseId: null`) are re-screened — an already-
   * subordinated or already-master case has nothing left to detect.
   */
  async scanOpenCases(): Promise<{
    companiesScanned: number
    casesScanned: number
    reviewsTouched: number
  }> {
    const companies = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findMany({ where: { status: 'active' }, select: { id: true } }),
    )

    let casesScanned = 0
    let reviewsTouched = 0

    for (const company of companies) {
      await this.rls.runAsCompany(company.id, async (tx) => {
        const openCases = await tx.case.findMany({
          where: { companyId: company.id, duplicateOfCaseId: null },
          select: { id: true },
        })
        for (const c of openCases) {
          const touched = await this.screenInTx(tx, company.id, c.id)
          casesScanned += 1
          reviewsTouched += touched.length
        }
      })
    }

    return { companiesScanned: companies.length, casesScanned, reviewsTouched }
  }

  async listForCase(actor: AuthenticatedUser, caseId: string): Promise<ReviewWithDecrypted[]> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const rows = await tx.duplicateReview.findMany({
        where: { companyId, OR: [{ caseId }, { matchedCaseId: caseId }] },
        include: {
          case: { select: { id: true, referenceNumber: true } },
          matchedCase: { select: { id: true, referenceNumber: true } },
        },
        orderBy: { detectedAt: 'desc' },
      })
      return rows.map((r) => this.decryptReview(r))
    })
  }

  /**
   * Always manual, per the guideline's explicit detection→confirmation
   * split. `resolutionPattern: 'allocation'` requires `masterCaseId` to
   * be one of the pair's own two case ids; `'creation'` ignores it and
   * always synthesizes a brand-new master via `createMasterCase()`.
   */
  async confirmDuplicate(
    actor: AuthenticatedUser,
    reviewId: string,
    dto: ConfirmDuplicateDto,
    meta: RequestMeta,
  ): Promise<{ review: ReviewWithDecrypted; masterCaseId: string }> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const review = await tx.duplicateReview.findFirst({ where: { id: reviewId, companyId } })
      if (!review) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Duplicate review not found' })
      }
      if (review.status !== 'possible') {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'This duplicate pair has already been reviewed',
        })
      }

      let masterCaseId: string
      if (dto.resolutionPattern === 'allocation') {
        if (dto.masterCaseId !== review.caseId && dto.masterCaseId !== review.matchedCaseId) {
          throw new BadRequestException({
            code: 'INVALID_MASTER_CASE',
            message: "masterCaseId must be either this review's caseId or matchedCaseId",
          })
        }
        masterCaseId = dto.masterCaseId
        const subordinateId = masterCaseId === review.caseId ? review.matchedCaseId : review.caseId
        await this.markSubordinate(tx, companyId, subordinateId, masterCaseId, actor, meta)
      } else {
        const master = await this.createMasterCase(
          tx,
          companyId,
          review.caseId,
          review.matchedCaseId,
          actor,
          meta,
        )
        masterCaseId = master.id
        await this.markSubordinate(tx, companyId, review.caseId, masterCaseId, actor, meta)
        await this.markSubordinate(tx, companyId, review.matchedCaseId, masterCaseId, actor, meta)
      }

      const updated = await tx.duplicateReview.update({
        where: { id: reviewId },
        data: {
          status: 'confirmed_duplicate',
          resolutionPattern: dto.resolutionPattern,
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
          reviewNoteEncrypted: dto.reviewNote ? this.textEncryption.encrypt(dto.reviewNote) : null,
        },
        include: {
          case: { select: { id: true, referenceNumber: true } },
          matchedCase: { select: { id: true, referenceNumber: true } },
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_duplicate_confirmed',
        recordType: PV_DUPLICATE_REVIEW_RECORD_TYPE,
        recordId: reviewId,
        oldValue: { status: 'possible' },
        newValue: {
          status: 'confirmed_duplicate',
          resolutionPattern: dto.resolutionPattern,
          masterCaseId,
        },
        ip: meta.ip,
      })

      return { review: this.decryptReview(updated), masterCaseId }
    })
  }

  /** Documents a genuine "not a duplicate" decision — the guideline's own process includes this, not just confirming true matches. Never touches either case. */
  async dismissDuplicate(
    actor: AuthenticatedUser,
    reviewId: string,
    dto: DismissDuplicateDto,
    meta: RequestMeta,
  ): Promise<ReviewWithDecrypted> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const review = await tx.duplicateReview.findFirst({ where: { id: reviewId, companyId } })
      if (!review) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Duplicate review not found' })
      }
      if (review.status !== 'possible') {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'This duplicate pair has already been reviewed',
        })
      }

      const updated = await tx.duplicateReview.update({
        where: { id: reviewId },
        data: {
          status: 'not_duplicate',
          reviewedBy: actor.sub,
          reviewedAt: new Date(),
          reviewNoteEncrypted: this.textEncryption.encrypt(dto.reviewNote),
        },
        include: {
          case: { select: { id: true, referenceNumber: true } },
          matchedCase: { select: { id: true, referenceNumber: true } },
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_duplicate_dismissed',
        recordType: PV_DUPLICATE_REVIEW_RECORD_TYPE,
        recordId: reviewId,
        oldValue: { status: 'possible' },
        newValue: { status: 'not_duplicate' },
        ip: meta.ip,
      })

      return this.decryptReview(updated)
    })
  }

  /** Never deletes, never overwrites a review someone has already decided on — a `possible` row is only ever updated in place (fresh `matchedFields`/`detectedAt`) if re-detected before anyone reviews it; the existing-in-either-direction check keeps a (caseId, matchedCaseId) pair from ever being recorded as two separate rows just because screening ran from both cases. */
  private async upsertReview(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
    matchedCaseId: string,
    matchedFields: DuplicateMatchedFields,
  ): Promise<DuplicateReview> {
    const existing = await tx.duplicateReview.findFirst({
      where: {
        companyId,
        OR: [
          { caseId, matchedCaseId },
          { caseId: matchedCaseId, matchedCaseId: caseId },
        ],
      },
    })

    if (existing) {
      if (existing.status !== 'possible') return existing
      return tx.duplicateReview.update({
        where: { id: existing.id },
        data: { matchedFields: matchedFields as Prisma.InputJsonValue, detectedAt: new Date() },
      })
    }

    return tx.duplicateReview.create({
      data: {
        id: newId(),
        companyId,
        caseId,
        matchedCaseId,
        status: 'possible',
        matchedFields: matchedFields as Prisma.InputJsonValue,
        detectedAt: new Date(),
      },
    })
  }

  private async markSubordinate(
    tx: Prisma.TransactionClient,
    companyId: string,
    subordinateId: string,
    masterCaseId: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ): Promise<void> {
    const before = await tx.case.findFirst({ where: { id: subordinateId, companyId } })
    await tx.case.update({
      where: { id: subordinateId },
      data: { duplicateOfCaseId: masterCaseId },
    })

    await this.auditService.log(tx, {
      companyId,
      actorUserId: actor.sub,
      action: 'pv_case_marked_duplicate',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: subordinateId,
      oldValue: { duplicateOfCaseId: before?.duplicateOfCaseId ?? null },
      newValue: { duplicateOfCaseId: masterCaseId },
      ip: meta.ip,
    })
  }

  /**
   * The Creation pattern: a brand-new `Case` synthesizing the two
   * subordinates' information. Pragmatic scope note — this clones the
   * *first* case's (`primaryId`) own reporter/patient as the master's
   * starting identity (rather than a field-by-field merge algorithm,
   * which the guideline doesn't actually prescribe a method for) and
   * takes the **union** of both cases' suspect products and adverse
   * events (with fresh `CausalityAssessment` stubs for every resulting
   * pair, mirroring `PvCaseService.buildCaseGraph()`'s own intake-time
   * behavior) — a real, usable master case, not a full deduplication of
   * every field. A pregnancy context, if either subordinate had one, is
   * deliberately not copied onto the master (rare in combination with a
   * duplicate pair; flagged here rather than silently guessed at).
   */
  private async createMasterCase(
    tx: Prisma.TransactionClient,
    companyId: string,
    primaryId: string,
    secondaryId: string,
    actor: AuthenticatedUser,
    meta: RequestMeta,
  ): Promise<Case> {
    const [primary, secondary] = await Promise.all([
      tx.case.findFirstOrThrow({
        where: { id: primaryId, companyId },
        include: { reporter: true, patient: true, suspectProducts: true, adverseEvents: true },
      }),
      tx.case.findFirstOrThrow({
        where: { id: secondaryId, companyId },
        include: { suspectProducts: true, adverseEvents: true },
      }),
    ])

    const referenceNumber = await this.generateUniqueReferenceNumber(tx, companyId)
    const awarenessDate =
      primary.awarenessDate < secondary.awarenessDate
        ? primary.awarenessDate
        : secondary.awarenessDate
    const receivedDate =
      primary.receivedDate < secondary.receivedDate ? primary.receivedDate : secondary.receivedDate

    const master = await tx.case.create({
      data: {
        id: newId(),
        companyId,
        referenceNumber,
        reportTypeId: primary.reportTypeId,
        countryOfOccurrenceId: primary.countryOfOccurrenceId,
        countryOfReportId: primary.countryOfReportId,
        channel: 'form',
        awarenessDate,
        receivedDate,
        createdBy: actor.sub,
        requiresDraftReview: false,
        additionalInformationEncrypted: this.textEncryption.encrypt(
          `Master Case synthesized from duplicate cases ${primary.referenceNumber} and ${secondary.referenceNumber}.`,
        ),
      },
    })

    if (primary.reporter) {
      await tx.reporter.create({
        data: {
          id: newId(),
          companyId,
          caseId: master.id,
          reporterType: primary.reporter.reporterType,
          fullName: primary.reporter.fullName,
          email: primary.reporter.email,
          phone: primary.reporter.phone,
          qualification: primary.reporter.qualification,
          countryId: primary.reporter.countryId,
          organization: primary.reporter.organization,
        },
      })
    }

    let masterPatient: Patient | null = null
    if (primary.patient) {
      masterPatient = await tx.patient.create({
        data: {
          id: newId(),
          companyId,
          caseId: master.id,
          initials: primary.patient.initials,
          dateOfBirth: primary.patient.dateOfBirth,
          ageYears: primary.patient.ageYears,
          sex: primary.patient.sex,
          weightKg: primary.patient.weightKg,
          heightCm: primary.patient.heightCm,
          medicalHistoryEncrypted: primary.patient.medicalHistoryEncrypted,
        },
      })
    }

    const newSuspectProductIds: string[] = []
    for (const sp of [...primary.suspectProducts, ...secondary.suspectProducts]) {
      const created = await tx.suspectProduct.create({
        data: {
          id: newId(),
          companyId,
          caseId: master.id,
          drugCharacterization: sp.drugCharacterization,
          medicinalProduct: sp.medicinalProduct,
          activeSubstanceName: sp.activeSubstanceName,
          atcCode: sp.atcCode,
          dosageForm: sp.dosageForm,
          route: sp.route,
          doseText: sp.doseText,
          batchNumber: sp.batchNumber,
          startDate: sp.startDate,
          endDate: sp.endDate,
          actionTaken: sp.actionTaken,
          obtainedCountryId: sp.obtainedCountryId,
          productId: sp.productId,
          isOverdose: sp.isOverdose,
          isOffLabelUse: sp.isOffLabelUse,
          isMisuse: sp.isMisuse,
          isMedicationError: sp.isMedicationError,
          whoDrugTermId: sp.whoDrugTermId,
        },
      })
      newSuspectProductIds.push(created.id)
    }

    const newAdverseEventIds: string[] = []
    for (const ae of [...primary.adverseEvents, ...secondary.adverseEvents]) {
      const created = await tx.adverseEvent.create({
        data: {
          id: newId(),
          companyId,
          caseId: master.id,
          meddraTermId: ae.meddraTermId,
          reportedTerm: ae.reportedTerm,
          narrativeEncrypted: ae.narrativeEncrypted,
          onsetDate: ae.onsetDate,
          resolutionDate: ae.resolutionDate,
          outcome: ae.outcome,
          seriousnessDeath: ae.seriousnessDeath,
          seriousnessLifeThreatening: ae.seriousnessLifeThreatening,
          seriousnessHospitalization: ae.seriousnessHospitalization,
          seriousnessDisabling: ae.seriousnessDisabling,
          seriousnessCongenitalAnomaly: ae.seriousnessCongenitalAnomaly,
          seriousnessOther: ae.seriousnessOther,
          isLackOfEfficacy: ae.isLackOfEfficacy,
        },
      })
      newAdverseEventIds.push(created.id)
    }

    for (const suspectProductId of newSuspectProductIds) {
      for (const adverseEventId of newAdverseEventIds) {
        await tx.causalityAssessment.create({
          data: { id: newId(), companyId, caseId: master.id, suspectProductId, adverseEventId },
        })
      }
    }

    await this.recordVersioningService.createVersion(
      actor,
      {
        recordType: PV_CASE_RECORD_TYPE,
        recordId: master.id,
        reason: `Master Case created (duplicate resolution — Creation pattern) from ${primary.referenceNumber} and ${secondary.referenceNumber}`,
        snapshot: { case: master, patient: masterPatient },
      },
      meta,
    )

    await this.workflowService.instantiate(
      actor,
      PV_CASE_RECORD_TYPE,
      master.id,
      master.countryOfReportId,
      meta,
    )

    await this.auditService.log(tx, {
      companyId,
      actorUserId: actor.sub,
      action: 'pv_case_created',
      recordType: PV_CASE_RECORD_TYPE,
      recordId: master.id,
      newValue: {
        referenceNumber: master.referenceNumber,
        synthesizedFrom: [primary.referenceNumber, secondary.referenceNumber],
      },
      ip: meta.ip,
    })

    return master
  }

  private async generateUniqueReferenceNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const year = new Date().getFullYear()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = randomInt(0, 100_000).toString().padStart(5, '0')
      const candidate = `PV-${year}-${suffix}`
      const existing = await tx.case.findFirst({ where: { companyId, referenceNumber: candidate } })
      if (!existing) return candidate
    }
    throw new Error('Could not generate a unique PV case reference number after 5 attempts')
  }

  private async loadCandidate(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
  ): Promise<CandidateCase | null> {
    const row = await tx.case.findFirst({
      where: { id: caseId, companyId },
      include: { patient: true, suspectProducts: true, adverseEvents: true },
    })
    if (!row) return null
    return this.toCandidate(row, row.patient, row.suspectProducts, row.adverseEvents)
  }

  private toCandidate(
    row: Case,
    patient: Patient | null,
    suspectProducts: { medicinalProduct: string; activeSubstanceName: string | null }[],
    adverseEvents: { reportedTerm: string }[],
  ): CandidateCase {
    return {
      id: row.id,
      countryOfOccurrenceId: row.countryOfOccurrenceId,
      awarenessDate: row.awarenessDate,
      patient: patient
        ? { sex: patient.sex, ageYears: patient.ageYears, dateOfBirth: patient.dateOfBirth }
        : null,
      productTerms: suspectProducts.flatMap((sp) => [
        sp.medicinalProduct,
        ...(sp.activeSubstanceName ? [sp.activeSubstanceName] : []),
      ]),
      reactionTerms: adverseEvents.map((ae) => ae.reportedTerm),
    }
  }

  private decryptReview(row: ReviewWithCases): ReviewWithDecrypted {
    const { reviewNoteEncrypted, ...rest } = row
    return {
      ...rest,
      reviewNote: reviewNoteEncrypted ? this.textEncryption.decrypt(reviewNoteEncrypted) : null,
    }
  }
}
