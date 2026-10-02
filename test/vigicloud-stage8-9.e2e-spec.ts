import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { TokenService } from '../src/modules/auth/services/token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

async function seedRoleWithPermissions(roleId: string, roleKey: string, permissionKeys: string[]): Promise<void> {
  await testPrisma.role.upsert({
    where: { id: roleId },
    update: {},
    create: { id: roleId, key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    })
  }
}

const NARANJO_ALL_NO = { q1: 'no', q2: 'no', q3: 'no', q4: 'no', q5: 'no', q6: 'no', q7: 'no', q8: 'no', q9: 'no', q10: 'no' }

/**
 * VigiCloud Stage 8 (Medical & Causality Review) + Stage 9 (QC Review,
 * Four-Eyes). Walks a case through the real seeded lifecycle — Intake →
 * Triage → Medical Review → Coding → Narrative → Quality Check — using
 * the same `WorkflowTransition` shape `workflow.seed-data.ts` defines
 * (including Stage 9's new narrative→medical_review reject path), since
 * the truncated-per-test e2e database never runs the dev seed.
 */
describe('VigiCloud Stage 8/9 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let superintendentRoleId: string
  let qppvRoleId: string
  let qualityAssociateRoleId: string

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage8-9 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    superintendentRoleId = randomUUID()
    qppvRoleId = randomUUID()
    qualityAssociateRoleId = randomUUID()
    await seedRoleWithPermissions(superintendentRoleId, 'SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case', 'documents.manage'])
    await seedRoleWithPermissions(qppvRoleId, 'QPPV', ['pv.capture_case', 'pv.medical_review', 'pv.view_all', 'documents.manage'])
    await seedRoleWithPermissions(qualityAssociateRoleId, 'QUALITY_ASSOCIATE', ['pv.view_all', 'pv.qc_review'])

    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })

    const stateKeys = ['intake', 'triage', 'medical_review', 'coding', 'narrative', 'quality_check', 'submission_ready', 'submitted'] as const
    const stateIds: Record<string, string> = {}
    for (const key of stateKeys) {
      stateIds[key] = randomUUID()
    }
    await testPrisma.workflowState.createMany({
      data: stateKeys.map((key) => ({ id: stateIds[key], definitionId, stateKey: key, name: key, isInitial: key === 'intake', isTerminal: key === 'submitted' })),
    })

    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId, fromStateId: stateIds.intake, toStateId: stateIds.triage, requiredRoleId: superintendentRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.triage, toStateId: stateIds.medical_review, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.medical_review, toStateId: stateIds.coding, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.coding, toStateId: stateIds.narrative, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.narrative, toStateId: stateIds.quality_check, requiredRoleId: qualityAssociateRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.narrative, toStateId: stateIds.medical_review, requiredRoleId: qualityAssociateRoleId, requiresSignature: false },
      ],
    })
  })

  async function actorWith(roleKey: string): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  /**
   * Grants an additional role to an already-existing e2e actor and mints a
   * fresh token reflecting it — `createAuthenticatedActor` always creates a
   * brand-new user, so simulating "the same person also holds another
   * role" (multi-role is normal in this app) needs a direct re-sign via
   * `TokenService`, mirroring exactly what `createAuthenticatedActor` does
   * internally for a first login.
   */
  async function addRoleAndReissueToken(existing: TestActor, additionalRoleKey: string): Promise<TestActor> {
    const user = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return tx.user.update({ where: { id: existing.userId }, data: { roleKeys: { push: additionalRoleKey } } })
    })
    const tokenService = app.get(TokenService)
    const accessToken = tokenService.signAccessToken(user)
    return { userId: existing.userId, cookieHeader: `access_token=${accessToken}; csrf=${existing.csrfHeader}`, csrfHeader: existing.csrfHeader }
  }

  function buildCasePayload() {
    return {
      reportTypeId,
      countryOfOccurrenceId: countryId,
      countryOfReportId: countryId,
      awarenessDate: '2026-08-01',
      receivedDate: '2026-08-01',
      reporter: { reporterType: 'consumer', fullName: 'Jane Doe' },
      patient: { ageYears: 40, sex: 'female' },
      suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
      adverseEvents: [{ reportedTerm: 'Itchy rash', narrative: 'Developed an itchy rash' }],
    }
  }

  async function createCaseAt(state: 'intake' | 'medical_review' | 'narrative', creator: TestActor) {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), creator).send(buildCasePayload()).expect(201)
    const caseId = created.body.data.id as string
    const causalityAssessmentId = created.body.data.causalityAssessments[0].id as string
    const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })

    if (state === 'intake') return { caseId, causalityAssessmentId, instanceId: instance.id }

    const documentId = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: creator.userId } })
    })
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), creator).send({ documentId }).expect(201)

    const superintendent = await actorWith('SUPERINTENDENT_PHARMACIST')
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), superintendent).send({ toStateKey: 'triage' }).expect(201)

    // `creator` (not a freshly-minted QPPV) does every remaining step — the
    // whole point of taking `creator` as a parameter is so callers can
    // later prove "the same person" did both case creation/causality
    // review *and* whatever they attempt next (e.g. the four-eyes test).
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), creator).send({ toStateKey: 'medical_review' }).expect(201)

    if (state === 'medical_review') return { caseId, causalityAssessmentId, instanceId: instance.id }

    // Fully assess causality so medical_review → coding → narrative can proceed.
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), creator)
      .send({ whoUmcCategory: 'possible', naranjoAnswers: NARANJO_ALL_NO })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), creator).send({ toStateKey: 'coding' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), creator).send({ toStateKey: 'narrative' }).expect(201)

    return { caseId, causalityAssessmentId, instanceId: instance.id }
  }

  describe('Stage 8 — Causality Assessment', () => {
    it('blocks Medical Review → Coding until every pair has both WHO-UMC and Naranjo set', async () => {
      const qppv = await actorWith('QPPV')
      const { instanceId } = await createCaseAt('medical_review', qppv)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv).send({ toStateKey: 'coding' }).expect(409)
      expect(blocked.body.error.message).toMatch(/causality assessment/i)
    })

    it('assessing WHO-UMC alone still blocks the transition until Naranjo is also set', async () => {
      const qppv = await actorWith('QPPV')
      const { instanceId, causalityAssessmentId, caseId } = await createCaseAt('medical_review', qppv)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), qppv)
        .send({ whoUmcCategory: 'possible' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv).send({ toStateKey: 'coding' }).expect(409)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), qppv)
        .send({ naranjoAnswers: NARANJO_ALL_NO })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv).send({ toStateKey: 'coding' }).expect(201)
    })

    it('computes the Naranjo score server-side and stores the real answer set for reproducibility', async () => {
      const qppv = await actorWith('QPPV')
      const { causalityAssessmentId, caseId } = await createCaseAt('medical_review', qppv)

      const answers = { ...NARANJO_ALL_NO, q2: 'yes', q4: 'yes' }
      const res = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), qppv)
        .send({ naranjoAnswers: answers })
        .expect(201)

      // baseline all-no = 1 (q2 no=-1, q4 no=-1 included in that baseline);
      // flipping q2 to yes swaps -1 for +2 (delta +3), same for q4 (delta +3) → 1+3+3 = 7
      expect(res.body.data.naranjoScore).toBe(7)

      const stored = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return tx.causalityAssessment.findUniqueOrThrow({ where: { id: causalityAssessmentId } })
      })
      expect(stored.naranjoAnswers).toEqual(answers)
    })

    it('404s for a causality-assessment id that does not belong to this case', async () => {
      const qppv = await actorWith('QPPV')
      const { caseId } = await createCaseAt('medical_review', qppv)

      const res = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${randomUUID()}`), qppv)
        .send({ whoUmcCategory: 'possible' })
        .expect(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('401s unauthenticated, 403s an actor without pv.medical_review', async () => {
      const qppv = await actorWith('QPPV')
      const { causalityAssessmentId, caseId } = await createCaseAt('medical_review', qppv)
      const outsider = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })

      await request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`).send({ whoUmcCategory: 'possible' }).expect(401)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), outsider)
        .send({ whoUmcCategory: 'possible' })
        .expect(403)
    })
  })

  describe('Stage 9 — QC Review (Four-Eyes)', () => {
    it('blocks Narrative → Quality Check when the QC actor is the same person who assessed causality', async () => {
      const qppv = await actorWith('QPPV')
      const { instanceId } = await createCaseAt('narrative', qppv)

      // Grant QUALITY_ASSOCIATE to the SAME user who did the causality assessment (multi-role is normal in this app).
      const sameActorReloggedIn = await addRoleAndReissueToken(qppv, 'QUALITY_ASSOCIATE')

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), sameActorReloggedIn)
        .send({ toStateKey: 'quality_check' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/cannot be the same person/i)
    })

    it('allows Narrative → Quality Check when the QC actor is a genuinely different person', async () => {
      const qppv = await actorWith('QPPV')
      const { instanceId } = await createCaseAt('narrative', qppv)
      const qualityAssociate = await actorWith('QUALITY_ASSOCIATE')

      const allowed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qualityAssociate)
        .send({ toStateKey: 'quality_check' })
        .expect(201)
      expect(allowed.body.data.id).toBe(instanceId)
    })

    it('the reject-to-Medical-Review path is never four-eyes-guarded, even for the same actor', async () => {
      const qppv = await actorWith('QPPV')
      const { instanceId, caseId } = await createCaseAt('narrative', qppv)

      const sameActor = await addRoleAndReissueToken(qppv, 'QUALITY_ASSOCIATE')

      // A reason is now required on this specific reject transition (real-usage request, 22 Sep 2026) — unrelated to four-eyes, which this test still asserts is absent here.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), sameActor)
        .send({ toStateKey: 'medical_review', note: 'Narrative needs the reaction timeline clarified before QC.' })
        .expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), sameActor).expect(200)
      expect(fetched.body.data.status).toBe('medical_review')
    })

    it('expectedness assessment now requires pv.qc_review, not pv.medical_review — the Stage 6 permission migration', async () => {
      const qppv = await actorWith('QPPV')
      const { caseId } = await createCaseAt('narrative', qppv)
      const qualityAssociate = await actorWith('QUALITY_ASSOCIATE')

      // The old Stage 6 stopgap permission no longer works for this endpoint.
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), qppv).send({ expectednessFlag: 'listed' }).expect(403)

      // The real Stage 9 QC-reviewer permission does.
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), qualityAssociate).send({ expectednessFlag: 'listed' }).expect(201)
    })
  })
})
