import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { SignatureTokenService } from '../src/modules/auth/services/signature-token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

/** `clinical_trial`/`clinical_trial_subject`/`task`/`regulatory_submission` all `FORCE ROW LEVEL SECURITY` — a bare `testPrisma` query against them returns zero rows silently without this, per CLAUDE.md's own RLS gotcha. */
function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

/**
 * Upserted by `roleKey`, not a caller-supplied id — a role key can
 * legitimately be seeded more than once across this file (the workflow
 * fixture in `beforeEach` and an individual test's own `actorWith()`
 * call both need 'REGULATORY_AFFAIRS_OFFICER' to exist, additively
 * granting more permissions each time), and the *real* row id (from
 * whichever call created it first) is what every subsequent grant and
 * `requiredRoleId` reference must use — never a fresh id the upsert
 * might not have actually used.
 */
async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<string> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
  return role.id
}

/**
 * VigiCloud Stage 13 (Per-Country Reporting Clock, Finalized) + Stage 14
 * (Clinical-Trial SAE Intake). Real HTTP coverage — a minimal
 * intake→submission_ready→submitted workflow fixture (like Stage 4/5's
 * own e2e spec, not the full 8-state production one) so the
 * `RegulatorySubmissionWorkflowGuards` regression test in particular
 * targets the exact guard logic without the unrelated medical-review/
 * causality/coding dance Stage 12's own spec needs for its E2B-shaped
 * concerns.
 */
describe('VigiCloud Stage 13/14 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let adrReportTypeId: string
  let clinicalTrialSaeReportTypeId: string
  let ppbAuthorityId: string
  let ethicsCommitteeAuthorityId: string
  let definitionId: string
  let stateIds: Record<'intake' | 'submission_ready' | 'submitted', string>

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage13-14 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    adrReportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: adrReportTypeId, typeKey: 'adr', name: 'Suspected ADR' } })
    clinicalTrialSaeReportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: clinicalTrialSaeReportTypeId, typeKey: 'clinical_trial_sae', name: 'Clinical Trial SAE' } })

    ppbAuthorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: ppbAuthorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })
    ethicsCommitteeAuthorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: ethicsCommitteeAuthorityId, countryId, code: 'ETHICS_COMMITTEE', name: 'Institutional Ethics Committee / Clinical Trial Portal' } })

    // Real ADR rule (for the "still works unchanged" half of Stage 13) + the real 24h clinical-trial SAE rule with its own submissionDestination.
    await testPrisma.reportingRule.createMany({
      data: [
        { id: randomUUID(), authorityId: ppbAuthorityId, reportTypeId: adrReportTypeId, seriousnessClass: 'serious', windowDays: 15, dayType: 'calendar', unverified: false, status: 'active', effectiveFrom: new Date('2024-01-01'), submissionDestination: 'regulator' },
        { id: randomUUID(), authorityId: ethicsCommitteeAuthorityId, reportTypeId: clinicalTrialSaeReportTypeId, seriousnessClass: 'serious', windowDays: 1, dayType: 'calendar', unverified: false, status: 'active', effectiveFrom: new Date('2024-01-01'), submissionDestination: 'ethics_committee_and_trial_portal' },
      ],
    })

    // A PPB/VigiFlow submission format for ADR (so the guard-fix test can
    // prove the *opposite* case — a report type that DOES route via
    // VigiFlow still correctly requires evidence) — none for
    // clinical_trial_sae, matching real seed data (no live gateway).
    await testPrisma.submissionFormat.create({
      data: { id: randomUUID(), authorityId: ppbAuthorityId, reportTypeId: adrReportTypeId, version: 1, templateRef: 'ppb.vigiflow.icsr.v1', channel: 'vigiflow', status: 'active', effectiveFrom: new Date('2024-01-01') },
    })

    definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const intakeId = randomUUID()
    const submissionReadyId = randomUUID()
    const submittedId = randomUUID()
    stateIds = { intake: intakeId, submission_ready: submissionReadyId, submitted: submittedId }
    await testPrisma.workflowState.createMany({
      data: [
        { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
        { id: submissionReadyId, definitionId, stateKey: 'submission_ready', name: 'Submission Ready', isInitial: false, isTerminal: false },
        { id: submittedId, definitionId, stateKey: 'submitted', name: 'Submitted', isInitial: false, isTerminal: true },
      ],
    })

    const raoRoleId = await seedRoleWithPermissions('REGULATORY_AFFAIRS_OFFICER', ['pv.capture_case', 'pv.view_all'])
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId, fromStateId: intakeId, toStateId: submissionReadyId, requiredRoleId: raoRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: submissionReadyId, toStateId: submittedId, requiredRoleId: raoRoleId, requiresSignature: false },
      ],
    })
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  /**
   * Real-usage request, 22 Sep 2026 (items 19/20) — `POST
   * /pv/clinical-trials` now requires a regulatory-authority approval
   * document and an ethics-committee approval document, each with its
   * own approval date. Every test in this file that creates a trial
   * spreads this into its payload — mirroring `linkAnySourceDocument()`'s
   * own direct-`Document`-row pattern just below.
   */
  async function approvalDocs(actor: TestActor): Promise<Record<string, string>> {
    const regulatoryApprovalDocumentId = randomUUID()
    const ethicsApprovalDocumentId = randomUUID()
    await withBypass(async (tx) => {
      await tx.document.create({ data: { id: regulatoryApprovalDocumentId, companyId, recordType: 'clinical_trial', recordId: companyId, title: 'Regulatory approval', createdBy: actor.userId } })
      await tx.document.create({ data: { id: ethicsApprovalDocumentId, companyId, recordType: 'clinical_trial', recordId: companyId, title: 'Ethics approval', createdBy: actor.userId } })
    })
    return {
      regulatoryApprovalDocumentId,
      regulatoryApprovalDate: '2025-01-01',
      ethicsApprovalDocumentId,
      ethicsApprovalDate: '2025-01-01',
    }
  }

  /** Stage 3.7's mandatory-source-document guard on `(pv_case, intake)` applies regardless of report type — every case needs one linked before it can leave Intake. */
  async function linkAnySourceDocument(actor: TestActor, caseId: string): Promise<void> {
    const documentId = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: actor.userId } })
    })
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), actor).send({ documentId }).expect(201)
  }

  function buildCasePayload(overrides: Record<string, unknown> = {}) {
    return {
      reportTypeId: adrReportTypeId,
      countryOfOccurrenceId: countryId,
      countryOfReportId: countryId,
      channel: 'form',
      awarenessDate: '2026-08-01',
      receivedDate: '2026-08-01',
      reporter: { reporterType: 'consumer', fullName: 'Jane Doe' },
      patient: { initials: 'J.D.' },
      suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
      adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash', seriousnessHospitalization: true }],
      ...overrides,
    }
  }

  describe('Stage 13 — Per-Country Reporting Clock, Finalized', () => {
    it('the real Kenya ADR rule still resolves unchanged (no rework)', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST_13', ['pv.capture_case', 'pv.triage_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string

      const classified = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)
      expect(classified.body.data.deadlineUnavailable).toBe(false)
      expect(classified.body.data.deadline.dueAt).toBeTruthy()
    })

    it('a clinical_trial_sae case classified serious resolves the real 24-hour rule against the Ethics Committee destination, not PPB', async () => {
      const actor = await actorWith('QPPV_13', ['pv.capture_case', 'pv.triage_case', 'pv.manage_clinical_trials'])
      const trial = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-0001', trialName: 'A Study of Panadol', countryId, startDate: '2025-01-01', ...(await approvalDocs(actor)) })
        .expect(201)

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reportTypeId: clinicalTrialSaeReportTypeId, channel: 'clinical_study', clinicalTrialId: trial.body.data.id }))
        .expect(201)
      const caseId = created.body.data.id as string

      const classified = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)
      expect(classified.body.data.deadlineUnavailable).toBe(false)
      const dueAt = new Date(classified.body.data.deadline.dueAt as string)
      const awareness = new Date('2026-08-01T00:00:00.000Z')
      // 24-hour clock: exactly one calendar day later than awareness, per `addWindowDays(..., 1, 'calendar')`.
      expect(dueAt.getTime() - awareness.getTime()).toBe(24 * 60 * 60 * 1000)

      const rule = await testPrisma.reportingRule.findFirstOrThrow({ where: { id: classified.body.data.deadline.reportingRuleId as string } })
      expect(rule.authorityId).toBe(ethicsCommitteeAuthorityId)
      expect(rule.authorityId).not.toBe(ppbAuthorityId)
      expect(rule.submissionDestination).toBe('ethics_committee_and_trial_portal')
    })
  })

  describe('Stage 14 — Clinical-Trial SAE Intake', () => {
    it('rejects a clinical_study-channel case with no clinicalTrialId — solicited data always traces back to a trial', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST_14A', ['pv.capture_case'])
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reportTypeId: clinicalTrialSaeReportTypeId, channel: 'clinical_study' }))
        .expect(400)
    })

    it('real-usage request, 22 Sep 2026 (items 19/20) — rejects trial creation with no regulatory or ethics approval document, requires both, and supports renewal', async () => {
      const actor = await actorWith('QPPV_14X', ['pv.manage_clinical_trials'])

      await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-APPR-1', trialName: 'A Study of Approvals', countryId, startDate: '2025-01-01' })
        .expect(400)

      const docs = await approvalDocs(actor)
      const wrongCompanyDoc = randomUUID()
      const otherCompanyId = randomUUID()
      await withBypass((tx) =>
        tx.company
          .create({ data: { id: otherCompanyId, name: 'Other Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
          .then(() => tx.document.create({ data: { id: wrongCompanyDoc, companyId: otherCompanyId, recordType: 'clinical_trial', recordId: otherCompanyId, title: 'Not this company', createdBy: actor.userId } })),
      )
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-APPR-2', trialName: 'A Study of Approvals', countryId, startDate: '2025-01-01', ...docs, regulatoryApprovalDocumentId: wrongCompanyDoc })
        .expect(404)

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-APPR-3', trialName: 'A Study of Approvals', countryId, startDate: '2025-01-01', ...docs, regulatoryApprovalExpiryDate: '2027-01-01' })
        .expect(201)
      expect(created.body.data.regulatoryApprovalDocumentId).toBe(docs.regulatoryApprovalDocumentId)
      expect(created.body.data.ethicsApprovalDocumentId).toBe(docs.ethicsApprovalDocumentId)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/clinical-trials/${created.body.data.id}`), actor).expect(200)
      expect(fetched.body.data.regulatoryApprovalStatus).toBe('valid')
      expect(fetched.body.data.ethicsApprovalStatus).toBe('no_expiry')

      const renewedDocId = randomUUID()
      await withBypass((tx) => tx.document.create({ data: { id: renewedDocId, companyId, recordType: 'clinical_trial', recordId: companyId, title: 'Renewed ethics approval', createdBy: actor.userId } }))
      const renewed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/${created.body.data.id}/renew-approval`), actor)
        .send({ approvalType: 'ethics', documentId: renewedDocId, approvalDate: '2027-06-01', expiryDate: '2028-06-01' })
        .expect(201)
      expect(renewed.body.data.ethicsApprovalDocumentId).toBe(renewedDocId)
      expect(renewed.body.data.regulatoryApprovalDocumentId).toBe(docs.regulatoryApprovalDocumentId) // untouched

      const audit = await testPrisma.auditEntry.findFirst({ where: { action: 'clinical_trial_approval_renewed', recordId: created.body.data.id as string } })
      expect(audit).toBeTruthy()
    })

    it('creates and manages a clinical trial, gated by pv.manage_clinical_trials', async () => {
      const manager = await actorWith('QPPV_14B', ['pv.manage_clinical_trials'])
      const readOnly = await actorWith('DISPENSING_PHARMACIST_14B', ['pv.capture_case'])
      const noAccess = await actorWith('EXECUTIVE_READONLY_14B', [])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), manager)
        .send({ trialReference: 'NCT-1001', trialName: 'A Study of Amoxil', countryId, startDate: '2025-01-01', sponsor: 'Acme Pharma', blindingType: 'double_blind', ...(await approvalDocs(manager)) })
        .expect(201)
      expect(created.body.data.trialReference).toBe('NCT-1001')

      // A capture_case-only actor can read (needed for the case-intake trial picker) but not create.
      await authed(request(httpServer(app)).get('/api/v1/pv/clinical-trials'), readOnly).expect(200)
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), readOnly)
        .send({ trialReference: 'NCT-1002', trialName: 'Should be forbidden', countryId, startDate: '2025-01-01' })
        .expect(403)

      // An actor with neither read-qualifying permission is rejected outright.
      await authed(request(httpServer(app)).get('/api/v1/pv/clinical-trials'), noAccess).expect(403)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/clinical-trials/${created.body.data.id}`), manager).expect(200)
      expect(fetched.body.data.openSaeCaseCount).toBe(0)
      expect(fetched.body.data.subjects).toEqual([])
    })

    it('enrolls a subject and links a case to both the trial and the subject', async () => {
      const actor = await actorWith('QPPV_14C', ['pv.capture_case', 'pv.manage_clinical_trials'])
      const trial = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-2001', trialName: 'A Study of Panadol', countryId, startDate: '2025-01-01', ...(await approvalDocs(actor)) })
        .expect(201)

      const subject = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/${trial.body.data.id}/subjects`), actor)
        .send({ subjectCode: 'SUBJ-01', enrolledAt: '2025-02-01', sex: 'female', ageYears: 40, treatmentArm: 'Arm B (placebo)' })
        .expect(201)
      // The blinded assignment is never returned by the enroll response.
      expect(subject.body.data.treatmentArmEncrypted).toBeUndefined()
      expect(subject.body.data.treatmentArm).toBeUndefined()

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reportTypeId: clinicalTrialSaeReportTypeId, channel: 'clinical_study', clinicalTrialId: trial.body.data.id, clinicalTrialSubjectId: subject.body.data.id }))
        .expect(201)
      expect(created.body.data.clinicalTrialId).toBe(trial.body.data.id)
      expect(created.body.data.clinicalTrialSubjectId).toBe(subject.body.data.id)

      const trialDetail = await authed(request(httpServer(app)).get(`/api/v1/pv/clinical-trials/${trial.body.data.id}`), actor).expect(200)
      expect(trialDetail.body.data.openSaeCaseCount).toBe(1)
      expect(trialDetail.body.data.subjects).toHaveLength(1)
      expect(trialDetail.body.data.subjects[0].treatmentArmEncrypted).toBeUndefined()
    })

    it('reveal-treatment-arm requires pv.unblind_treatment AND a real signature, and is audited distinctly from a normal read', async () => {
      const manager = await actorWith('QPPV_14D', ['pv.manage_clinical_trials', 'pv.unblind_treatment'])
      const noUnblindPermission = await actorWith('REGULATORY_AFFAIRS_OFFICER_14D', ['pv.manage_clinical_trials'])

      const trial = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), manager)
        .send({ trialReference: 'NCT-3001', trialName: 'A Study of Amoxil', countryId, startDate: '2025-01-01', ...(await approvalDocs(manager)) })
        .expect(201)
      const subject = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/${trial.body.data.id}/subjects`), manager)
        .send({ subjectCode: 'SUBJ-01', enrolledAt: '2025-02-01', treatmentArm: 'Arm A (active, 500mg)' })
        .expect(201)

      // A signature-gated action needs a real signature token — not just any string.
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/subjects/${subject.body.data.id}/reveal-treatment-arm`), manager)
        .send({ reason: 'Causality assessment', intentStatement: 'I confirm...', signatureToken: 'not-a-real-token' })
        .expect(401)

      // Permission-gated too, independent of having a valid signature token.
      const signatureTokenService = app.get(SignatureTokenService)
      const tokenForForbiddenActor = await signatureTokenService.issue(noUnblindPermission.userId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/subjects/${subject.body.data.id}/reveal-treatment-arm`), noUnblindPermission)
        .send({ reason: 'Causality assessment', intentStatement: 'I confirm...', signatureToken: tokenForForbiddenActor })
        .expect(403)

      const realToken = await signatureTokenService.issue(manager.userId)
      const revealed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/clinical-trials/subjects/${subject.body.data.id}/reveal-treatment-arm`), manager)
        .send({ reason: 'Causality assessment for SAE-014', intentStatement: 'I confirm the need to unblind this subject for safety evaluation', signatureToken: realToken })
        .expect(201)

      expect(revealed.body.data.treatmentArm).toBe('Arm A (active, 500mg)')
      expect(revealed.body.data.blindingBroken).toBe(true)

      // A normal trial-detail read still never exposes it.
      const trialDetail = await authed(request(httpServer(app)).get(`/api/v1/pv/clinical-trials/${trial.body.data.id}`), manager).expect(200)
      expect(trialDetail.body.data.subjects[0].treatmentArmEncrypted).toBeUndefined()
      expect(trialDetail.body.data.subjects[0].blindingBroken).toBe(true)

      // The reveal itself is a real, distinct SignatureEvent and audit entry — not folded into a normal GET.
      const signature = await testPrisma.signatureEvent.findFirst({ where: { recordType: 'clinical_trial_subject', recordId: subject.body.data.id } })
      expect(signature).toBeTruthy()
      const audit = await testPrisma.auditEntry.findFirst({ where: { action: 'clinical_trial_subject_treatment_arm_revealed', recordId: subject.body.data.id } })
      expect(audit).toBeTruthy()
    })

    it('bulk-imports clinical trial subjects via the generic Stage 0.6 importer framework', async () => {
      const actor = await actorWith('QPPV_14E', ['pv.manage_clinical_trials'])
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-4001', trialName: 'A Study of Panadol', countryId, startDate: '2025-01-01', ...(await approvalDocs(actor)) })
        .expect(201)

      const csvText = 'Trial Reference,Subject Code,Sex,Age,Enrollment Date\nNCT-4001,SUBJ-01,Female,29,2025-03-01\nNCT-4001,SUBJ-02,Male,55,2025-03-02\n'

      const preview = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/clinical_trial_patient/preview'), actor).send({ csvText }).expect(201)
      const validRows = preview.body.data.validRows as { data: Record<string, string> }[]
      expect(validRows).toHaveLength(2)
      expect(preview.body.data.invalidRows).toHaveLength(0)

      const commit = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/clinical_trial_patient/commit'), actor)
        .send({ rows: validRows.map((r) => r.data) })
        .expect(201)
      expect(commit.body.data.committed).toBe(2)

      const subjects = await withBypass((tx) =>
        tx.clinicalTrial.findFirstOrThrow({ where: { trialReference: 'NCT-4001' } }).then((trial) => tx.clinicalTrialSubject.findMany({ where: { clinicalTrialId: trial.id } })),
      )
      expect(subjects.map((s) => s.subjectCode).sort()).toEqual(['SUBJ-01', 'SUBJ-02'])
    })

    it('annual renewal reminder scan creates a real Task, assigned to QPPV, for a trial past its interval', async () => {
      const actor = await actorWith('QPPV_14F', ['pv.manage_clinical_trials'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-5001', trialName: 'A Study of Amoxil', countryId, startDate: '2020-01-01', ...(await approvalDocs(actor)) })
        .expect(201)

      const { ClinicalTrialAnnualReminderService } = await import('../src/modules/pv/clinical-trial-annual-reminder.service')
      const reminderService = app.get(ClinicalTrialAnnualReminderService)
      const result = await reminderService.scanAndRemind()
      expect(result.remindersCreated).toBeGreaterThanOrEqual(1)

      const task = await withBypass((tx) => tx.task.findFirst({ where: { recordType: 'clinical_trial_annual_renewal', recordId: created.body.data.id as string } }))
      expect(task).toBeTruthy()
      expect(task?.assignedRoleKey).toBe('QPPV')
    })
  })

  describe('RegulatorySubmissionWorkflowGuards regression (found while building Stage 14)', () => {
    it('a report type with no active vigiflow SubmissionFormat (clinical_trial_sae) reaches Submitted with zero RegulatorySubmission evidence required', async () => {
      // Role key must be exactly 'REGULATORY_AFFAIRS_OFFICER' — the required actor for both fixture transitions seeded in beforeEach.
      const actor = await actorWith('REGULATORY_AFFAIRS_OFFICER', ['pv.capture_case', 'pv.manage_clinical_trials', 'documents.manage'])
      const trial = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), actor)
        .send({ trialReference: 'NCT-6001', trialName: 'A Study of Panadol', countryId, startDate: '2025-01-01', ...(await approvalDocs(actor)) })
        .expect(201)
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reportTypeId: clinicalTrialSaeReportTypeId, channel: 'clinical_study', clinicalTrialId: trial.body.data.id }))
        .expect(201)
      const caseId = created.body.data.id as string
      await linkAnySourceDocument(actor, caseId)
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor).send({ toStateKey: 'submission_ready' }).expect(201)

      // Before the fix, this would 409 forever (no vigiflow format exists
      // for clinical_trial_sae, so no RegulatorySubmission could ever be
      // generated) — see RegulatorySubmissionWorkflowGuards' own doc comment.
      const submitted = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor).send({ toStateKey: 'submitted' }).expect(201)
      expect(submitted.body.data.currentStateId).toBe(stateIds.submitted)

      const regulatorySubmissionCount = await withBypass((tx) => tx.regulatorySubmission.count({ where: { caseId } }))
      expect(regulatorySubmissionCount).toBe(0)
    })

    it('a report type WITH an active vigiflow SubmissionFormat (ADR) is still correctly blocked without generated+evidenced submission', async () => {
      const actor = await actorWith('REGULATORY_AFFAIRS_OFFICER', ['pv.capture_case', 'documents.manage'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string
      await linkAnySourceDocument(actor, caseId)
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor).send({ toStateKey: 'submission_ready' }).expect(201)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor).send({ toStateKey: 'submitted' }).expect(409)
      expect(blocked.body.error.message).toMatch(/E2B submission/i)
    })
  })
})
