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

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
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
}

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

function buildCasePayload(overrides: Record<string, unknown> = {}, refs: { reportTypeId: string; countryId: string }) {
  return {
    reportTypeId: refs.reportTypeId,
    countryOfOccurrenceId: refs.countryId,
    countryOfReportId: refs.countryId,
    awarenessDate: '2026-08-01',
    receivedDate: '2026-08-02',
    reporter: { reporterType: 'consumer', fullName: 'Jane Doe' },
    patient: { ageYears: 40, sex: 'female' },
    suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
    adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash' }],
    ...overrides,
  }
}

/**
 * VigiCloud Stage 3.5 (call logging) + Stage 3.7 (mandatory source-document
 * transition gate + redacted-copy upload slot). Real HTTP coverage
 * exercising the full `pv_case` workflow this session's earlier specs
 * (`pv-case.e2e-spec.ts`) already re-derive.
 */
describe('VigiCloud Stage 3.5/3.7 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let intakeId: string
  let triageId: string

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage3.5-7 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    intakeId = randomUUID()
    triageId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
        { id: triageId, definitionId, stateKey: 'triage', name: 'Triage', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.create({
      data: { id: randomUUID(), definitionId, fromStateId: intakeId, toStateId: triageId, requiredRoleId: superintendentRoleId, requiresSignature: false },
    })
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  describe('Stage 3.5 — Call Log', () => {
    it('logs a call with no case (outcome not case_created)', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254700000001', occurredAt: '2026-08-07T09:00:00.000Z', outcome: 'information_only', notes: 'Just asking about side effects' })
        .expect(201)

      expect(created.body.data).toMatchObject({ callerNumber: '+254700000001', outcome: 'information_only', caseId: null })

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, action: 'pv_call_logged' } })
      expect(auditEntries).toHaveLength(1)
    })

    it('logs a call that creates a real, linked case with channel forced to hotline_phone', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({
          callerNumber: '+254700000002',
          occurredAt: '2026-08-07T09:00:00.000Z',
          outcome: 'case_created',
          case: buildCasePayload({}, { reportTypeId, countryId }),
        })
        .expect(201)

      const caseId = created.body.data.caseId as string
      expect(caseId).toBeTruthy()

      const rawCase = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseId } }))
      expect(rawCase.channel).toBe('hotline_phone')
      expect(rawCase.createdBy).toBe(actor.userId)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      expect(fetched.body.data.suspectProducts[0].medicinalProduct).toBe('Panadol')
    })

    it('400s when outcome is case_created but no case details are sent', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254700000003', occurredAt: '2026-08-07T09:00:00.000Z', outcome: 'case_created' })
        .expect(400)
    })

    it('lists call logs newest-first, filtered by caller-number search', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254700000004', occurredAt: '2026-08-07T09:00:00.000Z', outcome: 'unable_to_reach' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), actor)
        .send({ callerNumber: '+254711111111', occurredAt: '2026-08-07T09:05:00.000Z', outcome: 'unable_to_reach' })
        .expect(201)

      const list = await authed(request(httpServer(app)).get('/api/v1/pv/call-logs?search=254700'), actor).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].callerNumber).toBe('+254700000004')
    })

    it('401s unauthenticated, 403s an actor without pv.capture_case', async () => {
      await request(httpServer(app)).post('/api/v1/pv/call-logs').send({}).expect(401)

      const noPermActor = await actorWith('EXECUTIVE_READONLY', [])
      await authedWrite(request(httpServer(app)).post('/api/v1/pv/call-logs'), noPermActor)
        .send({ callerNumber: '+254700000005', occurredAt: '2026-08-07T09:00:00.000Z', outcome: 'unable_to_reach' })
        .expect(403)
    })
  })

  describe('Stage 3.7 — mandatory source-document transition gate', () => {
    it('blocks Intake → Triage with TRANSITION_NOT_ALLOWED when no source document is linked, then allows it once one is', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({}, { reportTypeId, countryId }))
        .expect(201)
      const caseId = created.body.data.id as string

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor)
        .send({ toStateKey: 'triage' })
        .expect(409)
      expect(blocked.body.error.code).toBe('TRANSITION_NOT_ALLOWED')
      expect(blocked.body.error.message).toMatch(/source document/i)

      const documentId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: actor.userId } })
      })
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), actor)
        .send({ documentId })
        .expect(201)

      const allowed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor)
        .send({ toStateKey: 'triage' })
        .expect(201)
      expect(allowed.body.data.id).toBe(instance.id)
    })
  })

  describe('Stage 3.7 — redacted-copy upload slot', () => {
    it('links a redacted-copy document distinct from the original when redacting', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({}, { reportTypeId, countryId }))
        .expect(201)
      const caseId = created.body.data.id as string

      const [documentId, redactedDocumentId] = [randomUUID(), randomUUID()]
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: actor.userId } })
        await tx.document.create({ data: { id: redactedDocumentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Redacted copy', createdBy: actor.userId } })
      })

      const linked = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), actor)
        .send({ documentId })
        .expect(201)

      const redacted = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/source-documents/${linked.body.data.id}/redact`), actor)
        .send({ redactedDocumentId })
        .expect(201)

      expect(redacted.body.data).toMatchObject({ redactionApplied: true, redactedDocumentId, redactedBy: actor.userId })
    })

    it('404s when redactedDocumentId was never uploaded against this case', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({}, { reportTypeId, countryId }))
        .expect(201)
      const caseId = created.body.data.id as string

      const documentId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: actor.userId } })
      })
      const linked = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), actor)
        .send({ documentId })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/source-documents/${linked.body.data.id}/redact`), actor)
        .send({ redactedDocumentId: randomUUID() })
        .expect(404)
    })
  })
})
