import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  AdverseEvent,
  Case,
  CaseChannel,
  CausalityAssessment,
  Deadline,
  MeddraTerm,
  Patient,
  PregnancyContext,
  Prisma,
  Reporter,
  ReportType,
  SuspectProduct,
  WhoDrugTerm,
} from '@prisma/client'
import { randomInt } from 'crypto'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { ConsentService } from '../consent/consent.service'
import { RecordVersioningService } from '../record-versioning/record-versioning.service'
import { RolesService } from '../roles/roles.service'
import { WorkflowService } from '../workflow/workflow.service'
import {
  AdverseEventInputDto,
  CreatePvCaseDto,
  PatientInputDto,
  ReporterInputDto,
  SuspectProductInputDto,
} from './dto/create-pv-case.dto'
import { ListPvCasesQueryDto } from './dto/list-pv-cases-query.dto'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { SignalTransitionLogEntry } from './signal.service'
import { ValidityGateResult, ValidityGateService } from './validity-gate.service'

export interface RequestMeta {
  ip?: string
}

export const PV_CASE_RECORD_TYPE = 'pv_case'

/** A pregnancy exposure's outcome follow-up is due roughly this long after the expected delivery date — WHO/ICH guidance expects a post-partum check, not an indefinite wait. Only computed when an expected delivery date is actually known. */
const PREGNANCY_FOLLOW_UP_WEEKS_AFTER_EDD = 8

/** A `Patient` with its encrypted field replaced by the real decrypted value — see the module-level note above `decryptCase()`. */
type PatientWithDecrypted = Omit<Patient, 'medicalHistoryEncrypted'> & {
  medicalHistory: string | null
}
/** An `AdverseEvent` with its encrypted field replaced by the real decrypted value, plus its joined MedDRA coding (Stage 7). */
type AdverseEventWithDecrypted = Omit<AdverseEvent, 'narrativeEncrypted'> & {
  narrative: string
  meddraTerm: MeddraTerm | null
}
/** A `SuspectProduct` with its joined WHODrug coding (Stage 7). */
type SuspectProductWithCoding = SuspectProduct & { whoDrugTerm: WhoDrugTerm | null }

export type CaseWithGraph = Omit<
  Case,
  'additionalInformationEncrypted' | 'expectednessNoteEncrypted'
> & {
  additionalInformation: string | null
  /** VigiCloud Stage 6 — decrypted; null until `ExpectednessService.assess()` runs, or when it ran with no note given. */
  expectednessNote: string | null
  reporter: Reporter | null
  patient: PatientWithDecrypted | null
  suspectProducts: SuspectProductWithCoding[]
  adverseEvents: AdverseEventWithDecrypted[]
  causalityAssessments: CausalityAssessment[]
  pregnancyContext?: PregnancyContext | null
  /** VigiCloud Stage 4 — always freshly computed, never cached on the row. */
  validityGate?: ValidityGateResult
  /** VigiCloud Stage 5 — the case's real computed reporting deadline, once `TriageService.classify()` has run at least once; null until then. */
  deadline?: Deadline | null
  /** VigiCloud Stage 8/9 — lets the frontend drive real workflow transitions (Medical Review → Coding, Narrative → Quality Check/Medical Review) directly from the case detail page via `GET/POST /workflow/instances/:id/...`, instead of only through the standalone Workflow Viewer tool. Null only if `create()` somehow ran without `WorkflowService.instantiate()` succeeding — should not happen in practice. */
  workflowInstanceId?: string | null
  /** Stage 1 task 1.1 — the report type selected at intake (ADR/Medication Error/Clinical Trial SAE/etc.), joined in for `get()` only so the case detail page can show it; `list()` still only exposes the bare `reportTypeId`. */
  reportType?: ReportType
  /** testing-todo Stage 17.1 — every workflow transition, with its documented rationale where one was given. Same mechanism `SignalService.get()` already established (a plain `AuditService.query()` read over `action: 'state_change'` entries, not a second history table) — `get()`-only, matching every other case-detail-only field above. */
  transitionHistory?: SignalTransitionLogEntry[]
}

interface CaseGraph {
  case: Case
  reporter: Reporter
  patient: Patient
  suspectProducts: SuspectProduct[]
  adverseEvents: AdverseEvent[]
  causalityAssessments: CausalityAssessment[]
  pregnancyContext: PregnancyContext | null
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

/**
 * Phase 11, Stage 1 (case graph) + Stage 3 (multi-channel intake) — the
 * root PV case service. `buildCaseGraph()` is the one place the full
 * intake graph (case, reporter, patient, N suspect products, N adverse
 * events, the N×M `CausalityAssessment` pairing, an optional pregnancy
 * context) actually gets created — shared by `create()` (an authenticated
 * staff member using the wizard) and `createFromSystemChannel()` (a case
 * with no logged-in human actor at all: the public reporting URL, inbound
 * email, or WhatsApp — see that method's own doc comment). Both wire the
 * same graph into every Stage 0 primitive: text encryption, consent
 * capture, record versioning, workflow instantiation (against the
 * already-seeded `pv_case` definition), and audit — all inside one
 * `RlsService.runAsCompany()` transaction.
 *
 * `CausalityAssessment` rows are created here as empty pairing stubs
 * (`whoUmcCategory`/`naranjoScore` both null) — the actual assessment is
 * Stage 8's job; Stage 1 only guarantees the pair exists to be assessed
 * against, per the todo doc's "modelled per (SuspectProduct × AdverseEvent)
 * pair, never once per case" instruction.
 */
@Injectable()
export class PvCaseService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly textEncryption: TextEncryptionService,
    private readonly consentService: ConsentService,
    private readonly recordVersioningService: RecordVersioningService,
    private readonly workflowService: WorkflowService,
    private readonly rolesService: RolesService,
    private readonly validityGateService: ValidityGateService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  /** An authenticated staff member submitting the case-intake wizard — every field on `CreatePvCaseDto` is exactly what they typed. */
  async create(
    actor: AuthenticatedUser,
    dto: CreatePvCaseDto,
    meta: RequestMeta,
  ): Promise<CaseWithGraph> {
    const companyId = requireCompany(actor)

    // VigiCloud Stage 14 — a clinical-trial SAE is solicited, not
    // spontaneous, and always traces back to a specific trial; every
    // other channel has nothing to check here. Only ever reachable
    // through the authenticated wizard (this method, not
    // `createFromSystemChannel()`) — an anonymous public/email/WhatsApp
    // submission naming itself a clinical-trial SAE isn't a real
    // operational scenario this build models.
    if ((dto.channel ?? 'form') === 'clinical_study' && !dto.clinicalTrialId) {
      throw new BadRequestException({
        code: 'CLINICAL_TRIAL_REQUIRED',
        message:
          'A clinical-trial SAE report requires a clinicalTrialId — this is solicited data, not a spontaneous report.',
      })
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.clinicalTrialId) {
        const trial = await tx.clinicalTrial.findFirst({
          where: { id: dto.clinicalTrialId, companyId },
        })
        if (!trial) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
        }
        if (dto.clinicalTrialSubjectId) {
          const subject = await tx.clinicalTrialSubject.findFirst({
            where: {
              id: dto.clinicalTrialSubjectId,
              companyId,
              clinicalTrialId: dto.clinicalTrialId,
            },
          })
          if (!subject) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: 'Clinical trial subject not found on this trial',
            })
          }
        }
      }

      const graph = await this.buildCaseGraph(tx, companyId, dto, {
        createdBy: actor.sub,
        channel: dto.channel ?? 'form',
        requiresDraftReview: false,
        sourceChannelReference: null,
      })

      // VigiCloud Stage 10 — detection at data entry, per the EMA
      // guideline: every new case is screened against the open-case
      // backlog immediately, inside this same transaction. Never blocks
      // or fails case creation — it only ever proposes `possible`
      // `DuplicateReview` rows for a human to later confirm/dismiss.
      await this.duplicateDetectionService.screenInTx(
        tx,
        companyId,
        graph.case.id,
        dto.citedCaseReferenceNumber ?? null,
      )

      if (dto.consent) {
        await this.consentService.capture(
          actor,
          {
            recordType: PV_CASE_RECORD_TYPE,
            recordId: graph.case.id,
            consentType: 'report',
            granted: dto.consent.granted,
            method: dto.consent.method,
          },
          meta,
        )
      }

      await this.recordVersioningService.createVersion(
        actor,
        {
          recordType: PV_CASE_RECORD_TYPE,
          recordId: graph.case.id,
          reason: 'Case created',
          snapshot: this.snapshotOf(graph),
        },
        meta,
      )

      await this.workflowService.instantiate(
        actor,
        PV_CASE_RECORD_TYPE,
        graph.case.id,
        dto.countryOfReportId,
        meta,
      )

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_created',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: graph.case.id,
        newValue: {
          referenceNumber: graph.case.referenceNumber,
          reportTypeId: dto.reportTypeId,
          channel: graph.case.channel,
        },
        ip: meta.ip,
      })

      return this.toCaseWithGraph(graph)
    })
  }

  /**
   * VigiCloud Stage 3 — a case with no logged-in human actor at all:
   * `PublicReportingService` (3.2), `EmailIntakeService` (3.3), and
   * `WhatsAppIntakeService` (3.4) all funnel into this one method rather
   * than each reimplementing case-graph creation. Always sets
   * `createdBy: null` and `requiresDraftReview: true` — per the Final
   * doc's "always lands for human triage" requirement for email/WhatsApp,
   * extended here to every unauthenticated channel for the same reason
   * (nothing a system extracted or a member of the public typed should
   * enter normal triage unconfirmed). A human with `pv.triage_case`
   * later calls `confirmDraft()` once they've reviewed it.
   *
   * `companyId` is resolved by the caller (slug lookup, intake-address
   * lookup, WhatsApp phone-number-ID lookup) — this method trusts it
   * rather than re-resolving, since each channel's resolution logic is
   * genuinely different.
   */
  async createFromSystemChannel(
    companyId: string,
    dto: CreatePvCaseDto,
    channel: CaseChannel,
    sourceChannelReference: string | null,
    meta: RequestMeta,
  ): Promise<CaseWithGraph> {
    return this.rls.runAsCompany(companyId, async (tx) => {
      const graph = await this.buildCaseGraph(tx, companyId, dto, {
        createdBy: null,
        channel,
        requiresDraftReview: true,
        sourceChannelReference,
      })

      // VigiCloud Stage 10 — same detection-at-creation guarantee for a
      // system-channel case (public URL/email/WhatsApp) as an
      // authenticated staff submission gets above.
      await this.duplicateDetectionService.screenInTx(
        tx,
        companyId,
        graph.case.id,
        dto.citedCaseReferenceNumber ?? null,
      )

      if (dto.consent) {
        await this.consentService.captureSystem(
          companyId,
          {
            recordType: PV_CASE_RECORD_TYPE,
            recordId: graph.case.id,
            consentType: 'report',
            granted: dto.consent.granted,
            method: dto.consent.method,
          },
          meta,
        )
      }

      await this.recordVersioningService.createVersion(
        { companyId },
        {
          recordType: PV_CASE_RECORD_TYPE,
          recordId: graph.case.id,
          reason: `Case created via ${channel}`,
          snapshot: this.snapshotOf(graph),
        },
        meta,
      )

      await this.workflowService.instantiate(
        { companyId },
        PV_CASE_RECORD_TYPE,
        graph.case.id,
        dto.countryOfReportId,
        meta,
      )

      await this.auditService.log(tx, {
        companyId,
        actorType: 'system',
        action: 'pv_case_created',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: graph.case.id,
        newValue: {
          referenceNumber: graph.case.referenceNumber,
          reportTypeId: dto.reportTypeId,
          channel,
          sourceChannelReference,
        },
        ip: meta.ip,
      })

      return this.toCaseWithGraph(graph)
    })
  }

  /**
   * VigiCloud Stage 3.3/3.4 — flips a draft-review case to a normal,
   * human-confirmed one, gated by `pv.triage_case` at the controller.
   * Deliberately does *not* re-validate or re-run the workflow — the case
   * already has a real `WorkflowInstance` at `intake` from creation time;
   * this only clears the flag that kept it out of normal triage views.
   */
  async confirmDraft(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Case> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.case.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }
      if (!existing.requiresDraftReview) {
        return existing
      }
      // Real-usage feedback, 19 Aug 2026 — "claim it and then work on
      // them... if not, then what's the use of claiming." A claim is
      // required before confirming, so two triagers can't both act on
      // the same draft-review case unnoticed.
      if (!existing.draftClaimedBy || existing.draftClaimedBy !== actor.sub) {
        throw new ConflictException({
          code: 'MUST_CLAIM_FIRST',
          message:
            'Claim this case before confirming it — someone else may already be reviewing it.',
        })
      }

      const updated = await tx.case.update({
        where: { id },
        data: { requiresDraftReview: false, draftClaimedBy: null, draftClaimedAt: null },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_draft_confirmed',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: { requiresDraftReview: true },
        newValue: { requiresDraftReview: false },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Real-usage feedback, 19 Aug 2026 — claims a draft-review case for the calling actor; 409s if someone else already holds the claim. */
  async claimDraft(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Case> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.case.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }
      if (!existing.requiresDraftReview) {
        throw new BadRequestException({
          code: 'NOT_A_DRAFT',
          message: 'This case is not in the draft-review queue',
        })
      }
      if (existing.draftClaimedBy && existing.draftClaimedBy !== actor.sub) {
        throw new ConflictException({
          code: 'ALREADY_CLAIMED',
          message: 'Another reviewer already claimed this case',
        })
      }

      const updated = await tx.case.update({
        where: { id },
        data: { draftClaimedBy: actor.sub, draftClaimedAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_draft_claimed',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: id,
        newValue: { draftClaimedBy: actor.sub },
        ip: meta.ip,
      })

      return updated
    })
  }

  /** Releases a claim so another reviewer can pick it up — only the current claimant (or anyone with `pv.view_all`, matching the Task Inbox's own "a manager can free up a stuck item" precedent) can release it. */
  async releaseDraft(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Case> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.case.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }
      if (!existing.draftClaimedBy) {
        return existing
      }
      if (existing.draftClaimedBy !== actor.sub) {
        const permissions = await this.rolesService.getPermissionsForUser(actor)
        if (!permissions.has('pv.view_all')) {
          throw new ForbiddenException({
            code: 'NOT_YOUR_CLAIM',
            message: 'Only the reviewer who claimed this case (or a supervisor) can release it',
          })
        }
      }

      const updated = await tx.case.update({
        where: { id },
        data: { draftClaimedBy: null, draftClaimedAt: null },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_draft_released',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: id,
        oldValue: { draftClaimedBy: existing.draftClaimedBy },
        ip: meta.ip,
      })

      return updated
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<CaseWithGraph> {
    const companyId = requireCompany(actor)
    const scope = await this.resolveViewScope(actor)

    const caseWithGraph = await this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.case.findFirst({
        where: { id, companyId, ...(scope === 'own' ? { createdBy: actor.sub } : {}) },
        include: {
          reporter: true,
          patient: true,
          suspectProducts: { include: { whoDrugTerm: true } },
          adverseEvents: { include: { meddraTerm: true } },
          causalityAssessments: true,
          pregnancyContext: true,
          reportType: true,
        },
      })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
      }

      const [validityGate, deadline, workflowInstance] = await Promise.all([
        this.validityGateService.evaluateInTx(tx, id),
        tx.deadline.findUnique({
          where: { recordType_recordId: { recordType: PV_CASE_RECORD_TYPE, recordId: id } },
        }),
        tx.workflowInstance.findFirst({
          where: { recordType: PV_CASE_RECORD_TYPE, recordId: id },
          include: { currentState: true },
        }),
      ])

      return {
        ...this.decryptCase(found),
        // `Case.status` is a denormalized cache that nothing currently
        // keeps in sync when a transition actually happens (see Stage 1's
        // own design note on this column) — the real `WorkflowInstance`
        // is the source of truth, so the single-case view reads it live
        // rather than trusting the column. `list()` still uses the stored
        // column for its filter/query performance; a known, deliberately
        // scoped gap, not an oversight.
        status: workflowInstance?.currentState.stateKey ?? found.status,
        reporter: found.reporter,
        patient: found.patient ? this.decryptPatient(found.patient) : null,
        suspectProducts: found.suspectProducts,
        adverseEvents: found.adverseEvents.map((ae) => this.decryptAdverseEvent(ae)),
        causalityAssessments: found.causalityAssessments,
        pregnancyContext: found.pregnancyContext,
        validityGate,
        deadline,
        workflowInstanceId: workflowInstance?.id ?? null,
        reportType: found.reportType,
      }
    })

    // testing-todo Stage 17.1 — same reasoning as `SignalService.get()`'s
    // identical read: `AuditService.query()` resolves actor names via its
    // own separate `runWithSystemAccess` call internally, so this must run
    // outside (after) the RLS-scoped transaction above, not nested inside
    // it — see the "Prisma include is subject to RLS on the joined table"
    // gotcha this pattern exists to avoid.
    const historyPage = await this.auditService.query(actor, {
      recordType: PV_CASE_RECORD_TYPE,
      recordId: id,
      action: 'state_change',
      page: 1,
      limit: 50,
    })
    const transitionHistory: SignalTransitionLogEntry[] = historyPage.data.map((entry) => {
      const oldValue = entry.oldValue as { stateKey?: string } | null
      const newValue = entry.newValue as { stateKey?: string; note?: string } | null
      return {
        fromStateKey: oldValue?.stateKey ?? null,
        toStateKey: newValue?.stateKey ?? '',
        note: newValue?.note ?? null,
        actorName: entry.actorName,
        occurredAt: entry.occurredAt,
      }
    })

    return { ...caseWithGraph, transitionHistory }
  }

  /**
   * Stage 1 tasks 1.4/4.2 — until now, a case that got stuck at the
   * Validity Gate (missing an identifiable patient/reporter/product/
   * event) had no way to actually be fixed: no edit endpoint existed at
   * all. These four methods are the deliberately narrow answer, scoped
   * to exactly what `ValidityGateService`'s own four criteria check —
   * not a general-purpose case editor. All four are restricted to a
   * case still sitting at Intake: editing reporter/patient details or
   * adding rows after Medical Review has already made a causality
   * judgment against the case's *existing* data would be a real
   * correctness risk this scope deliberately avoids. `updateReporter`/
   * `updatePatient` are full replaces (matching this codebase's own
   * "PATCH is always a full replace" convention, e.g.
   * `UsersService.updateRoles()`), not partial merges.
   */
  private async requireCaseAtIntake(
    tx: Prisma.TransactionClient,
    companyId: string,
    caseId: string,
  ): Promise<Case> {
    const found = await tx.case.findFirst({ where: { id: caseId, companyId } })
    if (!found) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'PV case not found' })
    }
    if (found.status !== 'intake') {
      throw new ForbiddenException({
        code: 'CASE_NOT_EDITABLE',
        message:
          'This case has already left Intake — reporter/patient details and suspect products/adverse events can no longer be edited here.',
      })
    }
    return found
  }

  async updateReporter(
    actor: AuthenticatedUser,
    caseId: string,
    dto: ReporterInputDto,
    meta: RequestMeta,
  ): Promise<Reporter> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.requireCaseAtIntake(tx, companyId, caseId)
      const existing = await tx.reporter.findFirst({ where: { caseId, companyId } })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Reporter not found for this case',
        })
      }

      const updated = await tx.reporter.update({
        where: { id: existing.id },
        data: {
          reporterType: dto.reporterType,
          fullName: dto.fullName ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          qualification: dto.qualification ?? null,
          countryId: dto.countryId ?? null,
          organization: dto.organization ?? null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_reporter_updated',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        ip: meta.ip,
      })

      return updated
    })
  }

  async updatePatient(
    actor: AuthenticatedUser,
    caseId: string,
    dto: PatientInputDto,
    meta: RequestMeta,
  ): Promise<PatientWithDecrypted> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.requireCaseAtIntake(tx, companyId, caseId)
      const existing = await tx.patient.findFirst({ where: { caseId, companyId } })
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Patient not found for this case',
        })
      }

      const updated = await tx.patient.update({
        where: { id: existing.id },
        data: {
          initials: dto.initials ?? null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          ageYears: dto.ageYears ?? null,
          sex: dto.sex ?? 'unknown',
          weightKg: dto.weightKg ?? null,
          heightCm: dto.heightCm ?? null,
          medicalHistoryEncrypted: dto.medicalHistory
            ? this.textEncryption.encrypt(dto.medicalHistory)
            : null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_patient_updated',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        ip: meta.ip,
      })

      return this.decryptPatient(updated)
    })
  }

  async addSuspectProduct(
    actor: AuthenticatedUser,
    caseId: string,
    dto: SuspectProductInputDto,
    meta: RequestMeta,
  ): Promise<SuspectProductWithCoding> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.requireCaseAtIntake(tx, companyId, caseId)

      const created = await tx.suspectProduct.create({
        data: {
          id: newId(),
          companyId,
          caseId,
          drugCharacterization: dto.drugCharacterization,
          medicinalProduct: dto.medicinalProduct,
          activeSubstanceName: dto.activeSubstanceName ?? null,
          atcCode: dto.atcCode ?? null,
          dosageForm: dto.dosageForm ?? null,
          route: dto.route ?? null,
          doseText: dto.doseText ?? null,
          batchNumber: dto.batchNumber ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          actionTaken: dto.actionTaken ?? null,
          obtainedCountryId: dto.obtainedCountryId ?? null,
          productId: dto.productId ?? null,
          isOverdose: dto.isOverdose ?? false,
          isOffLabelUse: dto.isOffLabelUse ?? false,
          isMisuse: dto.isMisuse ?? false,
          isMedicationError: dto.isMedicationError ?? false,
        },
      })

      // Stub a CausalityAssessment pairing against every adverse event
      // already on this case — matching `buildCaseGraph()`'s own N×M
      // pairing rule exactly, just applied to one new product instead of
      // the full initial set.
      const existingAdverseEvents = await tx.adverseEvent.findMany({ where: { caseId, companyId } })
      for (const ae of existingAdverseEvents) {
        await tx.causalityAssessment.create({
          data: {
            id: newId(),
            companyId,
            caseId,
            suspectProductId: created.id,
            adverseEventId: ae.id,
          },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_suspect_product_added',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        newValue: { suspectProductId: created.id, medicinalProduct: created.medicinalProduct },
        ip: meta.ip,
      })

      return { ...created, whoDrugTerm: null }
    })
  }

  async addAdverseEvent(
    actor: AuthenticatedUser,
    caseId: string,
    dto: AdverseEventInputDto,
    meta: RequestMeta,
  ): Promise<AdverseEventWithDecrypted> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      await this.requireCaseAtIntake(tx, companyId, caseId)

      const created = await tx.adverseEvent.create({
        data: {
          id: newId(),
          companyId,
          caseId,
          meddraTermId: dto.meddraTermId ?? null,
          reportedTerm: dto.reportedTerm,
          narrativeEncrypted: this.textEncryption.encrypt(dto.narrative),
          onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : null,
          resolutionDate: dto.resolutionDate ? new Date(dto.resolutionDate) : null,
          outcome: dto.outcome ?? 'unknown',
          seriousnessDeath: dto.seriousnessDeath ?? false,
          seriousnessLifeThreatening: dto.seriousnessLifeThreatening ?? false,
          seriousnessHospitalization: dto.seriousnessHospitalization ?? false,
          seriousnessDisabling: dto.seriousnessDisabling ?? false,
          seriousnessCongenitalAnomaly: dto.seriousnessCongenitalAnomaly ?? false,
          seriousnessOther: dto.seriousnessOther ?? false,
          isLackOfEfficacy: dto.isLackOfEfficacy ?? false,
        },
      })

      const existingSuspectProducts = await tx.suspectProduct.findMany({
        where: { caseId, companyId },
      })
      for (const sp of existingSuspectProducts) {
        await tx.causalityAssessment.create({
          data: {
            id: newId(),
            companyId,
            caseId,
            suspectProductId: sp.id,
            adverseEventId: created.id,
          },
        })
      }

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'pv_case_adverse_event_added',
        recordType: PV_CASE_RECORD_TYPE,
        recordId: caseId,
        newValue: { adverseEventId: created.id, reportedTerm: created.reportedTerm },
        ip: meta.ip,
      })

      return { ...this.decryptAdverseEvent(created), meddraTerm: null }
    })
  }

  async list(actor: AuthenticatedUser, query: ListPvCasesQueryDto): Promise<PaginatedResult<Case>> {
    const companyId = requireCompany(actor)
    const scope = await this.resolveViewScope(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(scope === 'own' ? { createdBy: actor.sub } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? { referenceNumber: { contains: query.search, mode: 'insensitive' as const } }
          : {}),
        ...(query.requiresDraftReview !== undefined
          ? { requiresDraftReview: query.requiresDraftReview }
          : {}),
      }

      const [rows, total] = await Promise.all([
        tx.case.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.case.count({ where }),
      ])

      return paginate(rows, total, query)
    })
  }

  /** `own` (only cases this actor personally created) unless the actor holds a cross-case view permission — mirrors `DISPENSING_PHARMACIST`'s "captures adverse events on their own reports only" business rule from `rbac.seed-data.ts`'s own role description. A system-channel case (`createdBy: null`) is never in anyone's "own" bucket — it belongs to nobody until a `pv.view_all`/`pv.triage_case` holder reviews it. */
  private async resolveViewScope(actor: AuthenticatedUser): Promise<'own' | 'all'> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (permissions.has('pv.view_all') || permissions.has('records.view_all')) {
      return 'all'
    }
    if (permissions.has('pv.capture_case')) {
      return 'own'
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view PV cases',
    })
  }

  /** Builds the whole case graph (case, reporter, patient, suspect products, adverse events, causality pairing, optional pregnancy context) inside the caller's already-open transaction. Shared by `create()` and `createFromSystemChannel()` — everything that differs between an authenticated and a system-channel case (who created it, what channel, whether it needs draft review) is passed in explicitly rather than each call site duplicating the graph-building logic. */
  private async buildCaseGraph(
    tx: Prisma.TransactionClient,
    companyId: string,
    dto: CreatePvCaseDto,
    opts: {
      createdBy: string | null
      channel: CaseChannel
      requiresDraftReview: boolean
      sourceChannelReference: string | null
    },
  ): Promise<CaseGraph> {
    const referenceNumber = await this.generateUniqueReferenceNumber(companyId)

    const created = await tx.case.create({
      data: {
        id: newId(),
        companyId,
        referenceNumber,
        reportTypeId: dto.reportTypeId,
        countryOfOccurrenceId: dto.countryOfOccurrenceId,
        countryOfReportId: dto.countryOfReportId,
        channel: opts.channel,
        clinicalTrialId: dto.clinicalTrialId ?? null,
        clinicalTrialSubjectId: dto.clinicalTrialSubjectId ?? null,
        awarenessDate: new Date(dto.awarenessDate),
        receivedDate: new Date(dto.receivedDate),
        additionalInformationEncrypted: dto.additionalInformation
          ? this.textEncryption.encrypt(dto.additionalInformation)
          : null,
        createdBy: opts.createdBy,
        requiresDraftReview: opts.requiresDraftReview,
        sourceChannelReference: opts.sourceChannelReference,
        suspectedFalsifiedOrSubstandard: dto.suspectedFalsifiedOrSubstandard ?? false,
      },
    })

    const reporter = await tx.reporter.create({
      data: {
        id: newId(),
        companyId,
        caseId: created.id,
        reporterType: dto.reporter.reporterType,
        fullName: dto.reporter.fullName ?? null,
        email: dto.reporter.email ?? null,
        phone: dto.reporter.phone ?? null,
        qualification: dto.reporter.qualification ?? null,
        countryId: dto.reporter.countryId ?? null,
        organization: dto.reporter.organization ?? null,
      },
    })

    const patient = await tx.patient.create({
      data: {
        id: newId(),
        companyId,
        caseId: created.id,
        initials: dto.patient.initials ?? null,
        dateOfBirth: dto.patient.dateOfBirth ? new Date(dto.patient.dateOfBirth) : null,
        ageYears: dto.patient.ageYears ?? null,
        sex: dto.patient.sex ?? 'unknown',
        weightKg: dto.patient.weightKg ?? null,
        heightCm: dto.patient.heightCm ?? null,
        medicalHistoryEncrypted: dto.patient.medicalHistory
          ? this.textEncryption.encrypt(dto.patient.medicalHistory)
          : null,
      },
    })

    const suspectProducts: SuspectProduct[] = []
    for (const input of dto.suspectProducts) {
      suspectProducts.push(
        await tx.suspectProduct.create({
          data: {
            id: newId(),
            companyId,
            caseId: created.id,
            drugCharacterization: input.drugCharacterization,
            medicinalProduct: input.medicinalProduct,
            activeSubstanceName: input.activeSubstanceName ?? null,
            atcCode: input.atcCode ?? null,
            dosageForm: input.dosageForm ?? null,
            route: input.route ?? null,
            doseText: input.doseText ?? null,
            batchNumber: input.batchNumber ?? null,
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
            actionTaken: input.actionTaken ?? null,
            obtainedCountryId: input.obtainedCountryId ?? null,
            productId: input.productId ?? null,
            isOverdose: input.isOverdose ?? false,
            isOffLabelUse: input.isOffLabelUse ?? false,
            isMisuse: input.isMisuse ?? false,
            isMedicationError: input.isMedicationError ?? false,
          },
        }),
      )
    }

    const adverseEvents: AdverseEvent[] = []
    for (const input of dto.adverseEvents) {
      adverseEvents.push(
        await tx.adverseEvent.create({
          data: {
            id: newId(),
            companyId,
            caseId: created.id,
            meddraTermId: input.meddraTermId ?? null,
            reportedTerm: input.reportedTerm,
            narrativeEncrypted: this.textEncryption.encrypt(input.narrative),
            onsetDate: input.onsetDate ? new Date(input.onsetDate) : null,
            resolutionDate: input.resolutionDate ? new Date(input.resolutionDate) : null,
            outcome: input.outcome ?? 'unknown',
            seriousnessDeath: input.seriousnessDeath ?? false,
            seriousnessLifeThreatening: input.seriousnessLifeThreatening ?? false,
            seriousnessHospitalization: input.seriousnessHospitalization ?? false,
            seriousnessDisabling: input.seriousnessDisabling ?? false,
            seriousnessCongenitalAnomaly: input.seriousnessCongenitalAnomaly ?? false,
            seriousnessOther: input.seriousnessOther ?? false,
            isLackOfEfficacy: input.isLackOfEfficacy ?? false,
          },
        }),
      )
    }

    const causalityAssessments: CausalityAssessment[] = []
    for (const suspectProduct of suspectProducts) {
      for (const adverseEvent of adverseEvents) {
        causalityAssessments.push(
          await tx.causalityAssessment.create({
            data: {
              id: newId(),
              companyId,
              caseId: created.id,
              suspectProductId: suspectProduct.id,
              adverseEventId: adverseEvent.id,
            },
          }),
        )
      }
    }

    let pregnancyContext: PregnancyContext | null = null
    if (dto.pregnancy) {
      const expectedDeliveryDate = dto.pregnancy.expectedDeliveryDate
        ? new Date(dto.pregnancy.expectedDeliveryDate)
        : null
      const followUpDueAt = expectedDeliveryDate
        ? new Date(
            expectedDeliveryDate.getTime() +
              PREGNANCY_FOLLOW_UP_WEEKS_AFTER_EDD * 7 * 24 * 60 * 60 * 1000,
          )
        : null

      pregnancyContext = await tx.pregnancyContext.create({
        data: {
          id: newId(),
          companyId,
          caseId: created.id,
          expectedDeliveryDate,
          gestationWeeksAtExposure: dto.pregnancy.gestationWeeksAtExposure ?? null,
          outcome: dto.pregnancy.outcome ?? 'ongoing',
          congenitalAnomalyDetail: dto.pregnancy.congenitalAnomalyDetail ?? null,
          followUpDueAt,
        },
      })
    }

    return {
      case: created,
      reporter,
      patient,
      suspectProducts,
      adverseEvents,
      causalityAssessments,
      pregnancyContext,
    }
  }

  private snapshotOf(graph: CaseGraph): Record<string, unknown> {
    return {
      case: graph.case,
      reporter: graph.reporter,
      patient: graph.patient,
      suspectProducts: graph.suspectProducts,
      adverseEvents: graph.adverseEvents,
      pregnancyContext: graph.pregnancyContext,
    }
  }

  private toCaseWithGraph(graph: CaseGraph): CaseWithGraph {
    return {
      ...this.decryptCase(graph.case),
      reporter: graph.reporter,
      patient: graph.patient ? this.decryptPatient(graph.patient) : null,
      suspectProducts: graph.suspectProducts.map((sp) => ({ ...sp, whoDrugTerm: null })),
      adverseEvents: graph.adverseEvents.map((ae) => ({
        ...this.decryptAdverseEvent(ae),
        meddraTerm: null,
      })),
      causalityAssessments: graph.causalityAssessments,
      pregnancyContext: graph.pregnancyContext,
    }
  }

  /**
   * Every case-level/reporter-level/patient-level free-text field is
   * encrypted at rest (Stage 0.3) — this is the one place that ever
   * decrypts them back for an authorized viewer. Before this fix, no
   * caller anywhere in the codebase ever called
   * `TextEncryptionService.decrypt()`, so the raw ciphertext (not even
   * excluded from the response) was the only thing an API client ever
   * saw — a real, previously-shipped defect found while wiring Stage 6's
   * own new encrypted field the same way. `additionalInformationEncrypted`/
   * `expectednessNoteEncrypted` are destructured off rather than merely
   * shadowed, so the ciphertext is structurally absent from the returned
   * object, not just overwritten by a same-named plaintext key.
   */
  private decryptCase(row: Case): Omit<
    Case,
    'additionalInformationEncrypted' | 'expectednessNoteEncrypted'
  > & {
    additionalInformation: string | null
    expectednessNote: string | null
  } {
    const { additionalInformationEncrypted, expectednessNoteEncrypted, ...rest } = row
    return {
      ...rest,
      additionalInformation: additionalInformationEncrypted
        ? this.textEncryption.decrypt(additionalInformationEncrypted)
        : null,
      expectednessNote: expectednessNoteEncrypted
        ? this.textEncryption.decrypt(expectednessNoteEncrypted)
        : null,
    }
  }

  private decryptPatient(row: Patient): PatientWithDecrypted {
    const { medicalHistoryEncrypted, ...rest } = row
    return {
      ...rest,
      medicalHistory: medicalHistoryEncrypted
        ? this.textEncryption.decrypt(medicalHistoryEncrypted)
        : null,
    }
  }

  private decryptAdverseEvent<T extends AdverseEvent>(
    row: T,
  ): Omit<T, 'narrativeEncrypted'> & { narrative: string } {
    const { narrativeEncrypted, ...rest } = row
    return { ...rest, narrative: this.textEncryption.decrypt(narrativeEncrypted) }
  }

  private async generateUniqueReferenceNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = randomInt(0, 100_000).toString().padStart(5, '0')
      const candidate = `PV-${year}-${suffix}`
      const existing = await this.rls.runAsCompany(companyId, (tx) =>
        tx.case.findFirst({ where: { companyId, referenceNumber: candidate } }),
      )
      if (!existing) {
        return candidate
      }
    }

    throw new Error('Could not generate a unique PV case reference number after 5 attempts')
  }
}
