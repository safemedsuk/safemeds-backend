import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ClinicalTrial, ClinicalTrialSubject, Prisma } from '@prisma/client'

import { TextEncryptionService } from '../../common/encryption/text-encryption.service'
import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RolesService } from '../roles/roles.service'
import { SignatureService } from '../signatures/signature.service'
import { CreateClinicalTrialDto } from './dto/create-clinical-trial.dto'
import { EnrollTrialSubjectDto } from './dto/enroll-trial-subject.dto'
import { ListClinicalTrialSubjectsQueryDto } from './dto/list-clinical-trial-subjects-query.dto'
import { ListClinicalTrialsQueryDto } from './dto/list-clinical-trials-query.dto'
import { RevealTreatmentArmDto } from './dto/reveal-treatment-arm.dto'
import { UpdateClinicalTrialDto } from './dto/update-clinical-trial.dto'

export interface RequestMeta {
  ip?: string
}

export const CLINICAL_TRIAL_RECORD_TYPE = 'clinical_trial'
export const CLINICAL_TRIAL_SUBJECT_RECORD_TYPE = 'clinical_trial_subject'

/** An annual renewal (line listing + DSUR, per Stage 14's own build-spec text) is due roughly a year after the trial started, or a year after the last reminder — same interval-from-last-event shape as Stage 2's quarterly product reminder. */
const ANNUAL_RENEWAL_INTERVAL_DAYS = 365

export type ClinicalTrialWithSummary = ClinicalTrial & {
  /** Cases linked to this trial not yet in the workflow's one terminal state (`submitted`) — the "open SAEs" half of Stage 14's own "trial-level dashboard" requirement. Uses the same denormalized `Case.status` column `PvCaseService.list()` already trusts for query performance. */
  openSaeCaseCount: number
  subjectCount: number
  /** Best-effort estimate for display — the real due-ness check (`ClinicalTrialAnnualReminderService`) derives from `Task` history the same way Stage 2's reminder does; this mirrors that logic for a single trial rather than duplicating a scan. */
  annualRenewalDueAt: Date
}

export type ClinicalTrialSubjectWithoutSecret = Omit<
  ClinicalTrialSubject,
  'treatmentArmEncrypted' | 'unblindingReasonEncrypted'
>

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Clinical trials are tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * VigiCloud Stage 14 — clinical trial setup and subject enrollment.
 * `revealTreatmentArm()` is the one genuinely new mechanism this service
 * introduces: reuses the existing electronic-signature engine
 * (`SignatureService`, the same one every workflow signature-gated
 * transition already goes through) rather than a bespoke unblinding
 * flow, per this stage's own build-spec text ("reusing the existing
 * electronic-signature engine"). Every other method is a standard
 * RLS-scoped tenant CRUD service, modeled directly on
 * `MasterDataService`'s product CRUD.
 */
@Injectable()
export class ClinicalTrialService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
    private readonly textEncryption: TextEncryptionService,
    private readonly signatureService: SignatureService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateClinicalTrialDto,
    meta: RequestMeta,
  ): Promise<ClinicalTrial> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.clinicalTrial.findUnique({
        where: { companyId_trialReference: { companyId, trialReference: dto.trialReference } },
      })
      if (existing) {
        throw new ConflictException({
          code: 'DUPLICATE_TRIAL_REFERENCE',
          message: 'A clinical trial with this reference already exists',
        })
      }

      const created = await tx.clinicalTrial.create({
        data: {
          id: newId(),
          companyId,
          trialReference: dto.trialReference,
          trialName: dto.trialName,
          sponsor: dto.sponsor ?? null,
          phase: dto.phase ?? null,
          blindingType: dto.blindingType ?? 'open_label',
          ethicsCommitteeName: dto.ethicsCommitteeName ?? null,
          ethicsCommitteeContactEmail: dto.ethicsCommitteeContactEmail ?? null,
          clinicalTrialPortalReference: dto.clinicalTrialPortalReference ?? null,
          countryId: dto.countryId,
          startDate: new Date(dto.startDate),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'clinical_trial_created',
        recordType: CLINICAL_TRIAL_RECORD_TYPE,
        recordId: created.id,
        newValue: { trialReference: created.trialReference, trialName: created.trialName },
        ip: meta.ip,
      })

      return created
    })
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateClinicalTrialDto,
    meta: RequestMeta,
  ): Promise<ClinicalTrial> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.clinicalTrial.findFirst({ where: { id, companyId } })
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      const updated = await tx.clinicalTrial.update({ where: { id }, data: dto })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'clinical_trial_updated',
        recordType: CLINICAL_TRIAL_RECORD_TYPE,
        recordId: id,
        oldValue: { status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      return updated
    })
  }

  async list(
    actor: AuthenticatedUser,
    query: ListClinicalTrialsQueryDto,
  ): Promise<PaginatedResult<ClinicalTrialWithSummary>> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { trialReference: { contains: query.q, mode: 'insensitive' as const } },
                { trialName: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        tx.clinicalTrial.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.clinicalTrial.count({ where }),
      ])

      const withSummary = await Promise.all(rows.map((row) => this.withSummary(tx, row)))
      return paginate(withSummary, total, query)
    })
  }

  async get(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<ClinicalTrialWithSummary & { subjects: ClinicalTrialSubjectWithoutSecret[] }> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.clinicalTrial.findFirst({ where: { id, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      const subjects = await tx.clinicalTrialSubject.findMany({
        where: { clinicalTrialId: id },
        orderBy: { enrolledAt: 'desc' },
      })
      const summary = await this.withSummary(tx, found)

      return { ...summary, subjects: subjects.map((s) => this.stripSecrets(s)) }
    })
  }

  /**
   * Special Corner SC-5 — the "Enrolled Subjects" table's own dedicated,
   * paginated read, distinct from `get()`'s embedded `subjects` field
   * (kept unpaginated on purpose: the case-intake subject picker and a
   * case's own linked-subject lookup both need to search/find across
   * the *complete* roster, not one page of it — a different consumption
   * pattern than a display table). A trial with a genuinely large
   * roster (bulk-imported, per Stage 14) would otherwise render every
   * row at once with no way to page through it.
   */
  async listSubjects(
    actor: AuthenticatedUser,
    trialId: string,
    query: ListClinicalTrialSubjectsQueryDto,
  ): Promise<PaginatedResult<ClinicalTrialSubjectWithoutSecret>> {
    const companyId = requireCompany(actor)
    await this.requireReadAccess(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const found = await tx.clinicalTrial.findFirst({ where: { id: trialId, companyId } })
      if (!found) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      const where = { clinicalTrialId: trialId }
      const [rows, total] = await Promise.all([
        tx.clinicalTrialSubject.findMany({
          where,
          orderBy: { enrolledAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.clinicalTrialSubject.count({ where }),
      ])

      return paginate(
        rows.map((s) => this.stripSecrets(s)),
        total,
        query,
      )
    })
  }

  async enrollSubject(
    actor: AuthenticatedUser,
    trialId: string,
    dto: EnrollTrialSubjectDto,
    meta: RequestMeta,
  ): Promise<ClinicalTrialSubjectWithoutSecret> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const trial = await tx.clinicalTrial.findFirst({ where: { id: trialId, companyId } })
      if (!trial) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Clinical trial not found' })
      }

      const existing = await tx.clinicalTrialSubject.findUnique({
        where: {
          clinicalTrialId_subjectCode: { clinicalTrialId: trialId, subjectCode: dto.subjectCode },
        },
      })
      if (existing) {
        throw new ConflictException({
          code: 'DUPLICATE_SUBJECT_CODE',
          message: 'A subject with this code is already enrolled in this trial',
        })
      }

      const created = await tx.clinicalTrialSubject.create({
        data: {
          id: newId(),
          companyId,
          clinicalTrialId: trialId,
          subjectCode: dto.subjectCode,
          sex: dto.sex ?? 'unknown',
          ageYears: dto.ageYears ?? null,
          enrolledAt: new Date(dto.enrolledAt),
          treatmentArmEncrypted: dto.treatmentArm
            ? this.textEncryption.encrypt(dto.treatmentArm)
            : null,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'clinical_trial_subject_enrolled',
        recordType: CLINICAL_TRIAL_SUBJECT_RECORD_TYPE,
        recordId: created.id,
        newValue: { clinicalTrialId: trialId, subjectCode: created.subjectCode },
        ip: meta.ip,
      })

      return this.stripSecrets(created)
    })
  }

  /** Used only by `ClinicalTrialSubjectImporter` — resolves a trial by its own reference number within the actor's company, since a bulk-import row names the trial by that human-readable reference, not its internal id. */
  async findTrialByReference(
    actor: AuthenticatedUser,
    trialReference: string,
  ): Promise<ClinicalTrial | null> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.clinicalTrial.findUnique({
        where: { companyId_trialReference: { companyId, trialReference } },
      }),
    )
  }

  /**
   * The one genuinely new mechanism Stage 14 introduces: a signature-gated
   * reveal of a subject's blinded treatment-arm assignment. `blindingBroken`/
   * `unblindedBy`/`unblindedAt` are set only the first time (an unblinding
   * event can't be undone in reality) — but every call still requires a
   * fresh signature and is independently, distinctly audited
   * (`clinical_trial_subject_treatment_arm_revealed`), whether or not the
   * blind was already broken by an earlier reveal. Never called as part
   * of a normal case/subject read — this is the only path that ever
   * returns the decrypted value.
   */
  async revealTreatmentArm(
    actor: AuthenticatedUser,
    subjectId: string,
    dto: RevealTreatmentArmDto,
    meta: RequestMeta,
  ): Promise<{ treatmentArm: string | null; blindingBroken: boolean; unblindedAt: Date | null }> {
    const companyId = requireCompany(actor)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const subject = await tx.clinicalTrialSubject.findFirst({
        where: { id: subjectId, companyId },
      })
      if (!subject) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Clinical trial subject not found',
        })
      }

      await this.signatureService.sign(
        tx,
        actor,
        {
          recordType: CLINICAL_TRIAL_SUBJECT_RECORD_TYPE,
          recordId: subjectId,
          intentStatement: dto.intentStatement,
          signatureToken: dto.signatureToken,
          roleAtSigning: actor.roleKeys[0] ?? 'unknown',
          canonicalPayload: {
            subjectId,
            action: 'reveal_treatment_arm',
            revealedAt: meta.ip ?? null,
          },
        },
        meta,
      )

      const isFirstReveal = !subject.blindingBroken
      const updated = await tx.clinicalTrialSubject.update({
        where: { id: subjectId },
        data: {
          blindingBroken: true,
          unblindedBy: isFirstReveal ? actor.sub : subject.unblindedBy,
          unblindedAt: isFirstReveal ? new Date() : subject.unblindedAt,
          unblindingReasonEncrypted: this.textEncryption.encrypt(dto.reason),
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'clinical_trial_subject_treatment_arm_revealed',
        recordType: CLINICAL_TRIAL_SUBJECT_RECORD_TYPE,
        recordId: subjectId,
        newValue: { reason: dto.reason, firstReveal: isFirstReveal },
        ip: meta.ip,
      })

      return {
        treatmentArm: updated.treatmentArmEncrypted
          ? this.textEncryption.decrypt(updated.treatmentArmEncrypted)
          : null,
        blindingBroken: updated.blindingBroken,
        unblindedAt: updated.unblindedAt,
      }
    })
  }

  /** Read access mirrors `PvCaseService.resolveViewScope()`'s exact reasoning — a single ANDed `@RequirePermissions()` can't express "capture, view-all, or manage" as alternatives, so this is a service-level OR check instead of a controller decorator. Anyone who can capture or view PV cases can read the trial catalog (needed for the case-intake trial picker); only `pv.manage_clinical_trials` can create/edit trials or enroll subjects. */
  private async requireReadAccess(actor: AuthenticatedUser): Promise<void> {
    const permissions = await this.rolesService.getPermissionsForUser(actor)
    if (
      permissions.has('pv.capture_case') ||
      permissions.has('pv.view_all') ||
      permissions.has('pv.manage_clinical_trials') ||
      permissions.has('records.view_all')
    ) {
      return
    }
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to view clinical trials',
    })
  }

  private async withSummary(
    tx: Prisma.TransactionClient,
    trial: ClinicalTrial,
  ): Promise<ClinicalTrialWithSummary> {
    const [openSaeCaseCount, subjectCount, mostRecentReminder] = await Promise.all([
      tx.case.count({ where: { clinicalTrialId: trial.id, status: { not: 'submitted' } } }),
      tx.clinicalTrialSubject.count({ where: { clinicalTrialId: trial.id } }),
      tx.task.findFirst({
        where: {
          companyId: trial.companyId,
          recordType: 'clinical_trial_annual_renewal',
          recordId: trial.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const renewalAnchor = mostRecentReminder?.createdAt ?? trial.startDate
    const annualRenewalDueAt = new Date(
      renewalAnchor.getTime() + ANNUAL_RENEWAL_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
    )

    return { ...trial, openSaeCaseCount, subjectCount, annualRenewalDueAt }
  }

  /**
   * Explicit field listing rather than a rest-destructure omission
   * (`const { treatmentArmEncrypted, ...rest } = subject`) — unlike
   * every other decrypt-and-strip helper in this module (`decryptCase()`
   * and friends), the two omitted fields here are never used for
   * anything, which `@typescript-eslint/no-unused-vars` (no
   * `ignoreRestSiblings` configured project-wide) correctly flags.
   */
  private stripSecrets(subject: ClinicalTrialSubject): ClinicalTrialSubjectWithoutSecret {
    return {
      id: subject.id,
      companyId: subject.companyId,
      clinicalTrialId: subject.clinicalTrialId,
      subjectCode: subject.subjectCode,
      sex: subject.sex,
      ageYears: subject.ageYears,
      enrolledAt: subject.enrolledAt,
      status: subject.status,
      blindingBroken: subject.blindingBroken,
      unblindedBy: subject.unblindedBy,
      unblindedAt: subject.unblindedAt,
      createdAt: subject.createdAt,
      updatedAt: subject.updatedAt,
    }
  }
}
