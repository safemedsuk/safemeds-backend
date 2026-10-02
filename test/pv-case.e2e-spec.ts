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

/** Idempotent — `beforeEach` already seeds `SUPERINTENDENT_PHARMACIST` for the workflow fixture, and a couple of tests also seed it via `actorWith()` for a different permission set. */
async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: {
      id: randomUUID(),
      key: roleKey,
      name: roleKey,
      description: 'e2e fixture',
      isPlatform: false,
    },
  })

  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({
      where: { key },
      update: {},
      create: { id: randomUUID(), key, description: 'e2e fixture' },
    })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
}

/**
 * `pv_case`/`pv_reporter`/`pv_patient`/`pv_adverse_event`/`consent_record`/
 * `record_version`/`task` all carry `FORCE ROW LEVEL SECURITY` — a raw read
 * through the plain, out-of-band `testPrisma` client (not one of
 * `RlsService`'s RLS-bound transactions) needs the same `app.bypass_rls`
 * session variable production's `runWithSystemAccess` sets, or Postgres
 * silently returns zero rows rather than erroring (the standard gotcha —
 * see `auth-refresh`/`vigicloud-stage0` specs for the same pattern).
 * `audit_entry`/`workflow_instance` have no RLS at all and don't need this.
 */
function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

const NARRATIVE_PLAINTEXT = 'Patient developed a severe rash within two hours of the first dose'
const MEDICAL_HISTORY_PLAINTEXT = 'History of penicillin allergy'
const ADDITIONAL_INFO_PLAINTEXT = 'Reported directly by the patient via the pharmacy hotline'

function buildCasePayload(
  overrides: Record<string, unknown> = {},
  refs: { reportTypeId: string; countryId: string },
) {
  return {
    reportTypeId: refs.reportTypeId,
    countryOfOccurrenceId: refs.countryId,
    countryOfReportId: refs.countryId,
    channel: 'form',
    awarenessDate: '2026-08-01',
    receivedDate: '2026-08-02',
    additionalInformation: ADDITIONAL_INFO_PLAINTEXT,
    reporter: {
      reporterType: 'healthcare_professional',
      fullName: 'Dr. Jane Wanjiru',
      email: 'jane@example.com',
      qualification: 'Pharmacist',
    },
    patient: {
      initials: 'J.M.',
      ageYears: 34,
      sex: 'female',
      medicalHistory: MEDICAL_HISTORY_PLAINTEXT,
    },
    suspectProducts: [
      {
        drugCharacterization: 'suspect',
        medicinalProduct: 'Amoxil 500mg',
        activeSubstanceName: 'Amoxicillin',
        batchNumber: 'B12345',
      },
      { drugCharacterization: 'concomitant', medicinalProduct: 'Panadol' },
    ],
    adverseEvents: [
      {
        reportedTerm: 'Skin rash',
        narrative: NARRATIVE_PLAINTEXT,
        seriousnessHospitalization: false,
      },
      { reportedTerm: 'Nausea', narrative: 'Mild nausea, resolved without treatment' },
    ],
    consent: { granted: true, method: 'written' },
    ...overrides,
  }
}

describe('VigiCloud Stage 1 — PV Case (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let definitionId: string

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
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'PV Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({
      data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' },
    })

    // Minimal re-derivation of the real seeded `pv_case` workflow (see
    // `workflow.e2e-spec.ts`'s own doc comment — the dev seed never runs
    // against the truncated-per-test e2e database), just enough for
    // `WorkflowService.instantiate()` to find an initial state and open a
    // task for the first outgoing transition's required role.
    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({
      data: {
        id: superintendentRoleId,
        key: 'SUPERINTENDENT_PHARMACIST',
        name: 'Superintendent Pharmacist',
        description: 'e2e fixture',
        isPlatform: false,
      },
    })
    definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: definitionId,
        recordType: 'pv_case',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    const intakeId = randomUUID()
    const triageId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        {
          id: intakeId,
          definitionId,
          stateKey: 'intake',
          name: 'Intake',
          isInitial: true,
          isTerminal: false,
        },
        {
          id: triageId,
          definitionId,
          stateKey: 'triage',
          name: 'Triage',
          isInitial: false,
          isTerminal: true,
        },
      ],
    })
    await testPrisma.workflowTransition.create({
      data: {
        id: randomUUID(),
        definitionId,
        fromStateId: intakeId,
        toStateId: triageId,
        requiredRoleId: superintendentRoleId,
        requiresSignature: false,
      },
    })
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  it('creates the full intake graph, wires consent/versioning/workflow/audit, and is retrievable via GET', async () => {
    const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)

    expect(created.body.data.referenceNumber).toMatch(/^[A-Z]{3}-\d{4}-[A-Z]{3}-\d{5}$/)
    const caseId = created.body.data.id as string

    const fetched = await authed(
      request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`),
      actor,
    ).expect(200)
    expect(fetched.body.data.reporter.fullName).toBe('Dr. Jane Wanjiru')
    expect(fetched.body.data.patient.initials).toBe('J.M.')
    expect(fetched.body.data.suspectProducts).toHaveLength(2)
    expect(fetched.body.data.adverseEvents).toHaveLength(2)

    // The GET response carries the real decrypted free text back, not the
    // ciphertext — real end-to-end proof (real HTTP, real encryption key,
    // not mocked) of the read-path fix documented in CLAUDE.md's gotchas
    // list: every encrypted field used to be write-only, decrypted nowhere.
    expect(fetched.body.data.additionalInformation).toBe(ADDITIONAL_INFO_PLAINTEXT)
    expect(fetched.body.data.additionalInformationEncrypted).toBeUndefined()
    expect(fetched.body.data.patient.medicalHistory).toBe(MEDICAL_HISTORY_PLAINTEXT)
    expect(fetched.body.data.patient.medicalHistoryEncrypted).toBeUndefined()
    const adverseEvents = fetched.body.data.adverseEvents as Array<{
      reportedTerm: string
      narrative: string
      narrativeEncrypted?: string
    }>
    const rashEventDecrypted = adverseEvents.find((e) => e.reportedTerm === 'Skin rash')!
    expect(rashEventDecrypted.narrative).toBe(NARRATIVE_PLAINTEXT)
    expect(rashEventDecrypted.narrativeEncrypted).toBeUndefined()
    // 2 suspect products x 2 adverse events = 4 causality pairing stubs, unassessed.
    expect(fetched.body.data.causalityAssessments).toHaveLength(4)
    for (const assessment of fetched.body.data.causalityAssessments) {
      expect(assessment.whoUmcCategory).toBeNull()
      expect(assessment.naranjoScore).toBeNull()
    }

    const consentRecords = await withBypass((tx) =>
      tx.consentRecord.findMany({ where: { companyId, recordType: 'pv_case', recordId: caseId } }),
    )
    expect(consentRecords).toHaveLength(1)
    expect(consentRecords[0]).toMatchObject({
      consentType: 'report',
      granted: true,
      method: 'written',
    })

    const versions = await withBypass((tx) =>
      tx.recordVersion.findMany({ where: { companyId, recordType: 'pv_case', recordId: caseId } }),
    )
    expect(versions).toHaveLength(1)
    expect(versions[0].versionNumber).toBe(1)

    const workflowInstance = await testPrisma.workflowInstance.findFirst({
      where: { recordType: 'pv_case', recordId: caseId },
    })
    expect(workflowInstance).not.toBeNull()
    expect(workflowInstance!.definitionId).toBe(definitionId)

    const tasks = await withBypass((tx) =>
      tx.task.findMany({ where: { companyId, recordType: 'pv_case', recordId: caseId } }),
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0].assignedRoleKey).toBe('SUPERINTENDENT_PHARMACIST')

    const auditEntries = await testPrisma.auditEntry.findMany({
      where: { companyId, recordType: 'pv_case', recordId: caseId, action: 'pv_case_created' },
    })
    expect(auditEntries).toHaveLength(1)
  })

  it('encrypts narrative, medical history, and additional-information text at rest — the raw row never contains the submitted plaintext', async () => {
    const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)
    const caseId = created.body.data.id as string

    const rawCase = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseId } }))
    expect(rawCase.additionalInformationEncrypted).not.toContain(ADDITIONAL_INFO_PLAINTEXT)
    expect(rawCase.additionalInformationEncrypted).not.toBeNull()

    const rawPatient = await withBypass((tx) => tx.patient.findFirstOrThrow({ where: { caseId } }))
    expect(rawPatient.medicalHistoryEncrypted).not.toContain(MEDICAL_HISTORY_PLAINTEXT)

    const rawEvents = await withBypass((tx) => tx.adverseEvent.findMany({ where: { caseId } }))
    const rashEvent = rawEvents.find((e) => e.reportedTerm === 'Skin rash')!
    expect(rashEvent.narrativeEncrypted).not.toContain(NARRATIVE_PLAINTEXT)
    expect(rashEvent.narrativeEncrypted.length).toBeGreaterThan(0)
  })

  it('own-only actor (pv.capture_case, no pv.view_all) sees only cases they created; a case they did not create 404s', async () => {
    const actorA = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
    const actorB = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['DISPENSING_PHARMACIST'],
    })

    const caseA = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actorA)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)
    const caseB = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actorB)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)

    const listAsA = await authed(request(httpServer(app)).get('/api/v1/pv/cases'), actorA).expect(
      200,
    )
    expect(listAsA.body.data).toHaveLength(1)
    expect(listAsA.body.data[0].id).toBe(caseA.body.data.id)

    await authed(
      request(httpServer(app)).get(`/api/v1/pv/cases/${caseB.body.data.id}`),
      actorA,
    ).expect(404)
  })

  it('an actor with pv.view_all sees every case in the company, including ones they did not create', async () => {
    const capturer = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
    const viewer = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.view_all'])

    await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), capturer)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)
    await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), viewer)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)

    const list = await authed(request(httpServer(app)).get('/api/v1/pv/cases'), viewer).expect(200)
    expect(list.body.data).toHaveLength(2)
  })

  it("never returns another company's PV cases (RLS isolation)", async () => {
    const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.view_all'])
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)

    const otherCountryId = randomUUID()
    await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
    const otherCompanyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: otherCompanyId,
        name: 'Other Co',
        companyType: 'manufacturer',
        homeCountryId: otherCountryId,
        status: 'active',
      },
    })
    await seedRoleWithPermissions('QPPV', ['pv.view_all'])
    const otherActor = await createAuthenticatedActor(app, testPrisma, {
      companyId: otherCompanyId,
      roleKeys: ['QPPV'],
    })

    await authed(
      request(httpServer(app)).get(`/api/v1/pv/cases/${created.body.data.id}`),
      otherActor,
    ).expect(404)
    const otherList = await authed(
      request(httpServer(app)).get('/api/v1/pv/cases'),
      otherActor,
    ).expect(200)
    expect(otherList.body.data).toHaveLength(0)
  })

  it('401s unauthenticated, 403s an actor with no pv.capture_case permission', async () => {
    await request(httpServer(app)).post('/api/v1/pv/cases').send({}).expect(401)

    const noPermActor = await actorWith('EXECUTIVE_READONLY', [])
    await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), noPermActor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(403)
  })

  it('400s when required nested arrays are missing (no suspect products / adverse events)', async () => {
    const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
    await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(
        buildCasePayload({ suspectProducts: [], adverseEvents: [] }, { reportTypeId, countryId }),
      )
      .expect(400)
  })

  it('links an already-uploaded document as a source document, lists it, and redacts it', async () => {
    const actor = await actorWith('DISPENSING_PHARMACIST', [
      'pv.capture_case',
      'documents.manage',
      'documents.view',
    ])

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)
    const caseId = created.body.data.id as string

    // A real Document row, as the generic Phase 8 upload handshake would
    // leave behind once its version reaches "stored" — inserted directly
    // since exercising the real R2 upload isn't this spec's concern.
    const documentId = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.document.create({
        data: {
          id: documentId,
          companyId,
          recordType: 'pv_case',
          recordId: caseId,
          title: 'Original report form',
          createdBy: actor.userId,
        },
      })
    })

    const linked = await authedWrite(
      request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`),
      actor,
    )
      .send({ documentId })
      .expect(201)
    expect(linked.body.data.documentId).toBe(documentId)
    expect(linked.body.data.redactionApplied).toBe(false)

    const list = await authed(
      request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}/source-documents`),
      actor,
    ).expect(200)
    expect(list.body.data).toHaveLength(1)

    const redacted = await authedWrite(
      request(httpServer(app)).post(`/api/v1/pv/source-documents/${linked.body.data.id}/redact`),
      actor,
    ).expect(201)
    expect(redacted.body.data.redactionApplied).toBe(true)
    expect(redacted.body.data.redactedBy).toBe(actor.userId)
  })

  it('404s linking a document that was never uploaded against this case', async () => {
    const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case', 'documents.manage'])
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send(buildCasePayload({}, { reportTypeId, countryId }))
      .expect(201)

    await authedWrite(
      request(httpServer(app)).post(`/api/v1/pv/cases/${created.body.data.id}/source-documents`),
      actor,
    )
      .send({ documentId: randomUUID() })
      .expect(404)
  })
})
