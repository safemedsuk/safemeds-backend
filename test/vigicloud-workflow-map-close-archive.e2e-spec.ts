import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

const NARANJO_ALL_NO = { q1: 'no', q2: 'no', q3: 'no', q4: 'no', q5: 'no', q6: 'no', q7: 'no', q8: 'no', q9: 'no', q10: 'no' }

/**
 * Real-usage request, 11 Sep 2026 — "SafeMeds VigiCloud Workflow Map"
 * document, master case lifecycle stage 9 ("Close & Archive: lock,
 * e-sign, archive; feed signals and trends", owner QPPV, "cannot close
 * with open obligations"). Builds its own complete 9-state fixture
 * definition (matching `vigicloud-stage12.e2e-spec.ts`'s own established
 * per-file-fixture pattern, extended past `submitted`) rather than
 * relying on any globally-seeded workflow data — every e2e spec in this
 * repo rebuilds its own workflow rows since `resetDatabase()` truncates
 * everything between tests.
 */
describe('VigiCloud Workflow Map — Close & Archive (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let superintendentRoleId: string
  let qppvRoleId: string
  let qualityAssociateRoleId: string
  let regulatoryAffairsRoleId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya', officialName: 'Republic of Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Close-Archive Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    superintendentRoleId = randomUUID()
    qppvRoleId = randomUUID()
    qualityAssociateRoleId = randomUUID()
    regulatoryAffairsRoleId = randomUUID()
    await seedRoleWithPermissions(superintendentRoleId, 'SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case', 'documents.manage'])
    await seedRoleWithPermissions(qppvRoleId, 'QPPV', ['pv.capture_case', 'pv.medical_review', 'pv.sign_icsr', 'pv.view_all', 'signatures.read', 'documents.manage'])
    await seedRoleWithPermissions(qualityAssociateRoleId, 'QUALITY_ASSOCIATE', ['pv.view_all', 'pv.qc_review'])
    await seedRoleWithPermissions(regulatoryAffairsRoleId, 'REGULATORY_AFFAIRS_OFFICER', ['pv.view_all', 'pv.triage_case', 'documents.manage'])

    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })

    const stateKeys = ['intake', 'triage', 'medical_review', 'coding', 'narrative', 'quality_check', 'submission_ready', 'submitted', 'closed_archived'] as const
    const stateIds: Record<string, string> = {}
    for (const key of stateKeys) stateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: stateKeys.map((key) => ({ id: stateIds[key], definitionId, stateKey: key, name: key, isInitial: key === 'intake', isTerminal: key === 'closed_archived' })),
    })

    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId, fromStateId: stateIds.intake, toStateId: stateIds.triage, requiredRoleId: superintendentRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.triage, toStateId: stateIds.medical_review, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.medical_review, toStateId: stateIds.coding, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.coding, toStateId: stateIds.narrative, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.narrative, toStateId: stateIds.quality_check, requiredRoleId: qualityAssociateRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.quality_check, toStateId: stateIds.submission_ready, requiredRoleId: qppvRoleId, requiresSignature: true },
        { id: randomUUID(), definitionId, fromStateId: stateIds.submission_ready, toStateId: stateIds.submitted, requiredRoleId: regulatoryAffairsRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId, fromStateId: stateIds.submitted, toStateId: stateIds.closed_archived, requiredRoleId: qppvRoleId, requiresSignature: true },
      ],
    })
  })

  async function seedRoleWithPermissions(roleId: string, roleKey: string, permissionKeys: string[]): Promise<void> {
    await testPrisma.role.upsert({ where: { id: roleId }, update: {}, create: { id: roleId, key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false } })
    for (const key of permissionKeys) {
      const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
      await testPrisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId, permissionId: permission.id } }, update: {}, create: { roleId, permissionId: permission.id } })
    }
  }

  async function actorWith(roleKey: string): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  function buildCasePayload(overrides: Record<string, unknown> = {}) {
    return {
      reportTypeId,
      countryOfOccurrenceId: countryId,
      countryOfReportId: countryId,
      awarenessDate: '2026-08-01',
      receivedDate: '2026-08-01',
      reporter: { reporterType: 'consumer', fullName: 'Jane Doe', email: 'jane@example.com' },
      patient: { ageYears: 40, sex: 'female' },
      suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol', activeSubstanceName: 'Paracetamol' }],
      adverseEvents: [{ reportedTerm: 'Itchy rash', narrative: 'Developed an itchy rash within hours of the first dose' }],
      ...overrides,
    }
  }

  /** Walks a freshly-created case all the way to `submitted`. */
  async function createCaseAtSubmitted(overrides: Record<string, unknown> = {}): Promise<{ caseId: string; instanceId: string; qppv: TestActor }> {
    const qppv = await actorWith('QPPV')
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), qppv).send(buildCasePayload(overrides)).expect(201)
    const caseId = created.body.data.id as string
    const causalityAssessmentId = created.body.data.causalityAssessments[0].id as string
    const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })

    const documentId = randomUUID()
    await withBypass((tx) => tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: qppv.userId } }))
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), qppv).send({ documentId }).expect(201)

    const superintendent = await actorWith('SUPERINTENDENT_PHARMACIST')
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), superintendent).send({ toStateKey: 'triage' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), superintendent).send({}).expect(201)

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), qppv).send({ toStateKey: 'medical_review' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/causality-assessments/${causalityAssessmentId}`), qppv)
      .send({ whoUmcCategory: 'possible', naranjoAnswers: NARANJO_ALL_NO })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), qppv).send({ toStateKey: 'coding' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), qppv).send({ toStateKey: 'narrative' }).expect(201)

    const qualityAssociate = await actorWith('QUALITY_ASSOCIATE')
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), qualityAssociate).send({ toStateKey: 'quality_check' }).expect(201)

    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    const signatureToken1 = await signatureTokenService.issue(qppv.userId)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), qppv)
      .send({ toStateKey: 'submission_ready', signatureToken: signatureToken1, intentStatement: 'I approve this ICSR for submission' })
      .expect(201)

    const regulatoryAffairsOfficer = await actorWith('REGULATORY_AFFAIRS_OFFICER')
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), regulatoryAffairsOfficer).send({ toStateKey: 'submitted' }).expect(201)

    return { caseId, instanceId: instance.id, qppv }
  }

  async function signatureTokenFor(userId: string): Promise<string> {
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    return app.get(SignatureTokenService).issue(userId)
  }

  it('closes and archives a submitted case with zero open obligations, setting Case.closedAt and the terminal state', async () => {
    const { caseId, instanceId, qppv } = await createCaseAtSubmitted()

    const token = await signatureTokenFor(qppv.userId)
    const closed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
      .send({ toStateKey: 'closed_archived', signatureToken: token, intentStatement: 'Locking and archiving this case' })
      .expect(201)
    expect(closed.body.data.id).toBe(instanceId)

    const finalCase = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), qppv).expect(200)
    expect(finalCase.body.data.status).toBe('closed_archived')

    const row = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseId } }))
    expect(row.closedAt).toBeInstanceOf(Date)
  })

  it('blocks closing while a follow-up cycle is still open, then allows it once resolved', async () => {
    const { caseId, instanceId, qppv } = await createCaseAtSubmitted()

    const regulatoryAffairsOfficerStart = await actorWith('REGULATORY_AFFAIRS_OFFICER')
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), regulatoryAffairsOfficerStart).send({}).expect(201)

    const token1 = await signatureTokenFor(qppv.userId)
    const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
      .send({ toStateKey: 'closed_archived', signatureToken: token1, intentStatement: 'Locking and archiving this case' })
      .expect(409)
    expect(blocked.body.error.message).toMatch(/open follow-up cycle/i)

    const followUp = await withBypass((tx) => tx.caseFollowUp.findFirstOrThrow({ where: { caseId } }))
    const regulatoryAffairsOfficer = await actorWith('REGULATORY_AFFAIRS_OFFICER')
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/case-follow-ups/${followUp.id}/log-attempt`), regulatoryAffairsOfficer)
      .send({ outcome: 'responded_resolved', note: 'Reporter confirmed no further information.' })
      .expect(201)

    const token2 = await signatureTokenFor(qppv.userId)
    const allowed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
      .send({ toStateKey: 'closed_archived', signatureToken: token2, intentStatement: 'Locking and archiving this case' })
      .expect(201)
    expect(allowed.body.data.id).toBe(instanceId)
  })

  it('blocks closing while a possible-duplicate review is unresolved (either side of the pairing), then allows it once dismissed', async () => {
    const { caseId, instanceId, qppv } = await createCaseAtSubmitted()
    // A deliberately non-matching second case (different patient age) — the
    // auto-detection-at-creation check must not independently flag this
    // pair, so the manually-inserted review below is the only one.
    const other = await createCaseAtSubmitted({ patient: { ageYears: 71, sex: 'male' } })

    const reviewId = randomUUID()
    await withBypass((tx) =>
      tx.duplicateReview.create({
        data: { id: reviewId, companyId, caseId: other.caseId, matchedCaseId: caseId, status: 'possible', matchedFields: ['country', 'sex', 'age'], detectedAt: new Date() },
      }),
    )

    const token1 = await signatureTokenFor(qppv.userId)
    const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
      .send({ toStateKey: 'closed_archived', signatureToken: token1, intentStatement: 'Locking and archiving this case' })
      .expect(409)
    expect(blocked.body.error.message).toMatch(/unresolved possible-duplicate/i)

    const regulatoryAffairsOfficer = await actorWith('REGULATORY_AFFAIRS_OFFICER')
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/duplicate-reviews/${reviewId}/dismiss`), regulatoryAffairsOfficer)
      .send({ reviewNote: 'Different patients, coincidental overlap.' })
      .expect(201)

    const token2 = await signatureTokenFor(qppv.userId)
    const allowed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qppv)
      .send({ toStateKey: 'closed_archived', signatureToken: token2, intentStatement: 'Locking and archiving this case' })
      .expect(201)
    expect(allowed.body.data.id).toBe(instanceId)
  })

  it('rejects closing by a role other than QPPV', async () => {
    const { instanceId } = await createCaseAtSubmitted()
    const regulatoryAffairsOfficer = await actorWith('REGULATORY_AFFAIRS_OFFICER')

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), regulatoryAffairsOfficer)
      .send({ toStateKey: 'closed_archived' })
      .expect(403)
  })
})
