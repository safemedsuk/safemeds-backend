import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

describe('Workflow engine + signatures (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  function authed(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader)
  }

  function authedWrite(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
  }

  async function createTestCompanyId(): Promise<string> {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    const companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })
    return companyId
  }

  /**
   * Re-derives the same minimal `pv_case` workflow v1 the real `prisma/seed.ts`
   * builds (Intake → Triage → Medical Review → Coding → Narrative → Quality
   * Check → Submission Ready → Submitted, QPPV approval signature-gated) —
   * `test/global-setup.ts` only runs migrations, not the dev seed, and
   * `setup-e2e.ts`'s `afterEach` truncates every table between specs anyway,
   * so this spec is self-contained rather than depending on seed data.
   */
  async function seedMinimalWorkflow() {
    const superintendentRoleId = 'aaaaaaaa-0000-0000-0000-000000000001'
    const qppvRoleId = 'aaaaaaaa-0000-0000-0000-000000000002'
    await testPrisma.role.createMany({
      data: [
        { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'test fixture', isPlatform: false },
        { id: qppvRoleId, key: 'QPPV', name: 'QPPV', description: 'test fixture', isPlatform: false },
      ],
    })
    const signaturesReadPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: signaturesReadPermissionId, key: 'signatures.read', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: qppvRoleId, permissionId: signaturesReadPermissionId } })

    const definitionId = 'bbbbbbbb-0000-0000-0000-000000000001'
    await testPrisma.workflowDefinition.create({
      data: { id: definitionId, recordType: 'workflow_test_record', reportTypeId: null, countryId: null, version: 1, status: 'active' },
    })

    const intakeId = 'cccccccc-0000-0000-0000-000000000001'
    const triageId = 'cccccccc-0000-0000-0000-000000000002'
    const qualityCheckId = 'cccccccc-0000-0000-0000-000000000003'
    const submissionReadyId = 'cccccccc-0000-0000-0000-000000000004'
    await testPrisma.workflowState.createMany({
      data: [
        { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
        { id: triageId, definitionId, stateKey: 'triage', name: 'Triage', isInitial: false, isTerminal: false },
        { id: qualityCheckId, definitionId, stateKey: 'quality_check', name: 'Quality Check', isInitial: false, isTerminal: false },
        { id: submissionReadyId, definitionId, stateKey: 'submission_ready', name: 'Submission Ready', isInitial: false, isTerminal: false },
      ],
    })

    await testPrisma.workflowTransition.createMany({
      data: [
        { id: 'dddddddd-0000-0000-0000-000000000001', definitionId, fromStateId: intakeId, toStateId: triageId, requiredRoleId: superintendentRoleId, requiresSignature: false },
        { id: 'dddddddd-0000-0000-0000-000000000002', definitionId, fromStateId: triageId, toStateId: qualityCheckId, requiredRoleId: qppvRoleId, requiresSignature: false },
        { id: 'dddddddd-0000-0000-0000-000000000003', definitionId, fromStateId: qualityCheckId, toStateId: submissionReadyId, requiredRoleId: qppvRoleId, requiresSignature: true },
      ],
    })

    return { definitionId, intakeId, triageId, qualityCheckId, submissionReadyId }
  }

  it('walks intake → triage → quality_check, then blocks the signature-gated transition without a token, then completes it with a real reauth token', async () => {
    await seedMinimalWorkflow()
    // Signing (`SignatureService.sign`) requires a tenant-scoped actor —
    // an explicit companyId is needed here (the other tests in this file
    // don't reach the signature-gated transition, so they don't need one).
    const actor = await createAuthenticatedActor(app, testPrisma, {
      roleKeys: ['SUPERINTENDENT_PHARMACIST', 'QPPV'],
      companyId: await createTestCompanyId(),
    })
    const recordId = randomUUID()

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/workflow/instances'), actor)
      .send({ recordType: 'workflow_test_record', recordId })
      .expect(201)
    const instanceId = created.body.data.id as string

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), actor)
      .send({ toStateKey: 'triage' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), actor)
      .send({ toStateKey: 'quality_check' })
      .expect(201)

    const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), actor)
      .send({ toStateKey: 'submission_ready' })
      .expect(403)
    expect(blocked.body.error.code).toBe('SIGNATURE_REQUIRED')

    // A real password + reauth flow needs a full login-capable user (MFA/lockout
    // machinery, etc.) that's out of scope for this spec — `createAuthenticatedActor`
    // mints a session token directly, so the signature-grade token is minted the
    // same way `SignatureTokenService.issue` would from inside a real reauth call.
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    const signatureToken = await signatureTokenService.issue(actor.userId)

    const signed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), actor)
      .send({ toStateKey: 'submission_ready', signatureToken, intentStatement: 'I approve this ICSR for submission' })
      .expect(201)
    expect(signed.body.data.id).toBe(instanceId)

    const signatures = await authed(
      request(httpServer(app)).get(`/api/v1/records/workflow_test_record/${recordId}/signatures`),
      actor,
    ).expect(200)
    expect(signatures.body.data).toHaveLength(1)
    expect(signatures.body.data[0]).toMatchObject({ roleAtSigning: 'QPPV', intentStatement: 'I approve this ICSR for submission' })
  })

  it('rejects a transition attempt from an actor lacking the required role with ROLE_REQUIRED', async () => {
    await seedMinimalWorkflow()
    const actor = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['DISPENSING_PHARMACIST'], companyId: await createTestCompanyId() })

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/workflow/instances'), actor)
      .send({ recordType: 'workflow_test_record', recordId: randomUUID() })
      .expect(201)

    const res = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${created.body.data.id}/transition`), actor)
      .send({ toStateKey: 'triage' })
      .expect(403)
    expect(res.body.error.code).toBe('ROLE_REQUIRED')
  })

  it('rejects skipping to a state with no transition from the current one', async () => {
    await seedMinimalWorkflow()
    const actor = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId: await createTestCompanyId() })

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/workflow/instances'), actor)
      .send({ recordType: 'workflow_test_record', recordId: randomUUID() })
      .expect(201)

    const res = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${created.body.data.id}/transition`), actor)
      .send({ toStateKey: 'submission_ready' })
      .expect(409)
    expect(res.body.error.code).toBe('TRANSITION_NOT_ALLOWED')
  })

  it("GET available-transitions reflects the actor's own roles", async () => {
    await seedMinimalWorkflow()
    const withRole = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId: await createTestCompanyId() })
    const withoutRole = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['DISPENSING_PHARMACIST'] })

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/workflow/instances'), withRole)
      .send({ recordType: 'workflow_test_record', recordId: randomUUID() })
      .expect(201)
    const instanceId = created.body.data.id as string

    const asOwner = await authed(request(httpServer(app)).get(`/api/v1/workflow/instances/${instanceId}/available-transitions`), withRole).expect(200)
    expect(asOwner.body.data[0].allowed).toBe(true)

    const asOther = await authed(request(httpServer(app)).get(`/api/v1/workflow/instances/${instanceId}/available-transitions`), withoutRole).expect(200)
    expect(asOther.body.data[0].allowed).toBe(false)
  })
})
