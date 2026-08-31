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

/**
 * VigiCloud Stage 6 (Expectedness/Listedness) + Stage 7 (MedDRA + WHODrug
 * Coding). Real HTTP coverage — seeds its own tiny MedDRA/WHODrug
 * dictionary versions directly (the dev seed never runs against the
 * truncated-per-test e2e database, same as every other PV e2e spec).
 */
describe('VigiCloud Stage 6/7 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let meddraTermId: string
  let whoDrugTermId: string

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage6-7 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    const meddraVersionId = randomUUID()
    await testPrisma.meddraVersion.create({ data: { id: meddraVersionId, versionLabel: `TEST-${randomUUID()}`, releasedOn: new Date('2026-01-01') } })
    meddraTermId = randomUUID()
    await testPrisma.meddraTerm.create({ data: { id: meddraTermId, versionId: meddraVersionId, code: 'T-0001', level: 'LLT', name: 'Itchy rash' } })

    const whoDrugVersionId = randomUUID()
    await testPrisma.whoDrugVersion.create({ data: { id: whoDrugVersionId, versionLabel: `TEST-${randomUUID()}`, releasedOn: new Date('2026-01-01') } })
    whoDrugTermId = randomUUID()
    await testPrisma.whoDrugTerm.create({ data: { id: whoDrugTermId, versionId: whoDrugVersionId, drugRecordNumber: 'DRN-0001', name: 'Panadol', substanceName: 'PARACETAMOL', atcCode: 'N02BE01' } })

    // Minimal re-derivation of the real seeded `pv_case` workflow — the dev
    // seed never runs against the truncated-per-test e2e database, same as
    // every other PV e2e spec — just enough for `WorkflowService.instantiate()`
    // (called internally by `POST /pv/cases`) to find an initial state.
    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const intakeId = randomUUID()
    const triageId = randomUUID()
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

  async function createCase(actor: TestActor): Promise<{ caseId: string; adverseEventId: string; suspectProductId: string }> {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
    return {
      caseId: created.body.data.id as string,
      adverseEventId: created.body.data.adverseEvents[0].id as string,
      suspectProductId: created.body.data.suspectProducts[0].id as string,
    }
  }

  describe('Stage 7 — MedDRA coding', () => {
    it('codes an adverse event, returns the joined term on GET, and audits the action', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId, adverseEventId } = await createCase(actor)

      const coded = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`), actor)
        .send({ meddraTermId })
        .expect(201)
      expect(coded.body.data.meddraTermId).toBe(meddraTermId)
      expect(coded.body.data.meddraCodedBy).toBeTruthy()
      expect(coded.body.data.meddraCodedAt).toBeTruthy()

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      const adverseEvents = fetched.body.data.adverseEvents as Array<{ id: string; meddraTerm: unknown }>
      const event = adverseEvents.find((e) => e.id === adverseEventId)!
      expect(event.meddraTerm).toMatchObject({ id: meddraTermId, name: 'Itchy rash', level: 'LLT', code: 'T-0001' })

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, recordId: caseId, action: 'pv_adverse_event_coded' } })
      expect(auditEntries).toHaveLength(1)
    })

    it('re-coding overwrites the term and audits old→new', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId, adverseEventId } = await createCase(actor)

      const secondVersionId = randomUUID()
      await testPrisma.meddraVersion.create({ data: { id: secondVersionId, versionLabel: `TEST-2-${randomUUID()}`, releasedOn: new Date('2026-06-01') } })
      const newerTermId = randomUUID()
      await testPrisma.meddraTerm.create({ data: { id: newerTermId, versionId: secondVersionId, code: 'T-0002', level: 'LLT', name: 'Skin eruption' } })

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`), actor).send({ meddraTermId }).expect(201)
      const recoded = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`), actor)
        .send({ meddraTermId: newerTermId })
        .expect(201)
      expect(recoded.body.data.meddraTermId).toBe(newerTermId)

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, recordId: caseId, action: 'pv_adverse_event_coded' }, orderBy: { occurredAt: 'asc' } })
      expect(auditEntries).toHaveLength(2)
      expect(auditEntries[1].oldValue).toMatchObject({ meddraTermId })
      expect(auditEntries[1].newValue).toMatchObject({ meddraTermId: newerTermId })
    })

    it('404s for a nonexistent MedDRA term id', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId, adverseEventId } = await createCase(actor)

      const res = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`), actor)
        .send({ meddraTermId: randomUUID() })
        .expect(404)
      expect(res.body.error.code).toBe('MEDDRA_TERM_NOT_FOUND')
    })

    it('401s unauthenticated, 403s an actor without pv.medical_review', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      const { caseId, adverseEventId } = await createCase(actor)

      await request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`).send({ meddraTermId }).expect(401)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/adverse-events/${adverseEventId}/code`), actor).send({ meddraTermId }).expect(403)
    })
  })

  describe('Stage 7 — WHODrug coding', () => {
    it('codes a suspect product, returns the joined term on GET, and audits the action', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId, suspectProductId } = await createCase(actor)

      const coded = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/suspect-products/${suspectProductId}/code`), actor)
        .send({ whoDrugTermId })
        .expect(201)
      expect(coded.body.data.whoDrugTermId).toBe(whoDrugTermId)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      const suspectProducts = fetched.body.data.suspectProducts as Array<{ id: string; whoDrugTerm: unknown }>
      const product = suspectProducts.find((p) => p.id === suspectProductId)!
      expect(product.whoDrugTerm).toMatchObject({ id: whoDrugTermId, name: 'Panadol', substanceName: 'PARACETAMOL', atcCode: 'N02BE01' })

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, recordId: caseId, action: 'pv_suspect_product_coded' } })
      expect(auditEntries).toHaveLength(1)
    })

    it('404s for a nonexistent WHODrug term id', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId, suspectProductId } = await createCase(actor)

      const res = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/suspect-products/${suspectProductId}/code`), actor)
        .send({ whoDrugTermId: randomUUID() })
        .expect(404)
      expect(res.body.error.code).toBe('WHODRUG_TERM_NOT_FOUND')
    })
  })

  describe('MedDRA/WHODrug search', () => {
    it('GET /meddra/search finds the seeded term by name', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case'])
      const res = await authed(request(httpServer(app)).get('/api/v1/meddra/search?q=itchy'), actor).expect(200)
      const results = res.body.data as Array<{ id: string }>
      expect(results.some((t) => t.id === meddraTermId)).toBe(true)
    })

    it('GET /who-drug/search finds the seeded term by name or substance', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case'])
      const byName = await authed(request(httpServer(app)).get('/api/v1/who-drug/search?q=panadol'), actor).expect(200)
      const byNameResults = byName.body.data as Array<{ id: string }>
      expect(byNameResults.some((t) => t.id === whoDrugTermId)).toBe(true)

      const bySubstance = await authed(request(httpServer(app)).get('/api/v1/who-drug/search?q=paracetamol'), actor).expect(200)
      const bySubstanceResults = bySubstance.body.data as Array<{ id: string }>
      expect(bySubstanceResults.some((t) => t.id === whoDrugTermId)).toBe(true)
    })
  })

  describe('Stage 6 — Expectedness/Listedness', () => {
    it('assesses expectedness with a note, returns it decrypted on GET, and audits the action', async () => {
      // Stage 9 moved this endpoint's gate from pv.medical_review to
      // pv.qc_review (see vigicloud-stage8-9.e2e-spec.ts for the dedicated
      // migration test) — grant both so this actor can create the case
      // (pv.capture_case) and assess expectedness (pv.qc_review).
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.qc_review'])
      const { caseId } = await createCase(actor)

      const assessed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), actor)
        .send({ expectednessFlag: 'unlisted', note: 'Not listed in the current PPB-approved SmPC (v3, Jan 2026).' })
        .expect(201)
      expect(assessed.body.data.expectednessFlag).toBe('unlisted')

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      expect(fetched.body.data.expectednessFlag).toBe('unlisted')
      expect(fetched.body.data.expectednessNote).toBe('Not listed in the current PPB-approved SmPC (v3, Jan 2026).')
      expect(fetched.body.data.expectednessNoteEncrypted).toBeUndefined()
      expect(fetched.body.data.expectednessAssessedBy).toBeTruthy()
      expect(fetched.body.data.expectednessAssessedAt).toBeTruthy()

      const rawCase = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return tx.case.findUniqueOrThrow({ where: { id: caseId } })
      })
      expect(rawCase.expectednessNoteEncrypted).not.toContain('Not listed in the current PPB-approved SmPC')

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, recordId: caseId, action: 'pv_case_expectedness_assessed' } })
      expect(auditEntries).toHaveLength(1)
      expect(auditEntries[0].oldValue).toMatchObject({ expectednessFlag: 'not_assessed' })
      expect(auditEntries[0].newValue).toMatchObject({ expectednessFlag: 'unlisted' })
    })

    it('defaults to not_assessed with a null note on a freshly created case', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case'])
      const { caseId } = await createCase(actor)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      expect(fetched.body.data.expectednessFlag).toBe('not_assessed')
      expect(fetched.body.data.expectednessNote).toBeNull()
    })

    it('reassessment is callable more than once and updates in place', async () => {
      const actor = await actorWith('QPPV', ['pv.capture_case', 'pv.qc_review'])
      const { caseId } = await createCase(actor)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), actor).send({ expectednessFlag: 'listed' }).expect(201)
      const second = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), actor)
        .send({ expectednessFlag: 'unlisted', note: 'Label updated, term no longer covered' })
        .expect(201)
      expect(second.body.data.expectednessFlag).toBe('unlisted')
    })

    it('401s unauthenticated, 403s an actor without pv.qc_review — including one who only has the old pv.medical_review', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      const { caseId } = await createCase(actor)

      await request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`).send({ expectednessFlag: 'listed' }).expect(401)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/expectedness`), actor).send({ expectednessFlag: 'listed' }).expect(403)

      const qppvOnly = await actorWith('QPPV', ['pv.capture_case', 'pv.medical_review'])
      const { caseId: qppvCaseId } = await createCase(qppvOnly)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${qppvCaseId}/expectedness`), qppvOnly).send({ expectednessFlag: 'listed' }).expect(403)
    })
  })
})
