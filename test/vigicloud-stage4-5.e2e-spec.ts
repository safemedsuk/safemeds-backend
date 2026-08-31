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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setUTCDate(result.getUTCDate() + n)
  return result
}

/**
 * VigiCloud Stage 4 (Validity Gate) + Stage 5 (Triage & Seriousness).
 * Real HTTP coverage against the real seeded-Kenya-style reporting
 * rules (fatal=7d, serious=15d, non_serious=30d, calendar days —
 * mirroring `country-rules.seed-data.ts`'s actual ADR rules, not
 * fabricated numbers).
 */
describe('VigiCloud Stage 4/5 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let adrReportTypeId: string
  let unverifiedReportTypeId: string
  let authorityId: string
  const awarenessDate = '2026-08-01'

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
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage4-5 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    adrReportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: adrReportTypeId, typeKey: 'adr', name: 'Suspected ADR' } })
    unverifiedReportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: unverifiedReportTypeId, typeKey: 'medication_error', name: 'Medication Error' } })

    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })

    // The real three-tier Kenya ADR rule set (GUD/022 §6.1), active and verified.
    await testPrisma.reportingRule.createMany({
      data: [
        { id: randomUUID(), authorityId, reportTypeId: adrReportTypeId, seriousnessClass: 'fatal', windowDays: 7, dayType: 'calendar', unverified: false, status: 'active', effectiveFrom: new Date('2024-01-01') },
        { id: randomUUID(), authorityId, reportTypeId: adrReportTypeId, seriousnessClass: 'serious', windowDays: 15, dayType: 'calendar', unverified: false, status: 'active', effectiveFrom: new Date('2024-01-01') },
        { id: randomUUID(), authorityId, reportTypeId: adrReportTypeId, seriousnessClass: 'non_serious', windowDays: 30, dayType: 'calendar', unverified: false, status: 'active', effectiveFrom: new Date('2024-01-01') },
      ],
    })
    // medication_error only ever has unverified candidates for real (see CLAUDE.md) — none seeded active here at all.

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

  function buildCasePayload(overrides: Record<string, unknown> = {}) {
    return {
      reportTypeId: adrReportTypeId,
      countryOfOccurrenceId: countryId,
      countryOfReportId: countryId,
      awarenessDate,
      receivedDate: awarenessDate,
      reporter: { reporterType: 'consumer' },
      patient: {},
      suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
      adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash' }],
      ...overrides,
    }
  }

  async function linkAnySourceDocument(actor: TestActor, caseId: string): Promise<void> {
    const documentId = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.document.create({ data: { id: documentId, companyId, recordType: 'pv_case', recordId: caseId, title: 'Original report form', createdBy: actor.userId } })
    })
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/source-documents`), actor).send({ documentId }).expect(201)
  }

  describe('Stage 4 — Validity Gate', () => {
    it('GET /pv/cases/:id returns validityGate.allowed=false naming exactly which criteria are missing', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])
      // No reporter/patient identifying fields at all — reporterType alone isn't identifying.
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${created.body.data.id}`), actor).expect(200)

      expect(fetched.body.data.validityGate.allowed).toBe(false)
      const criteria = fetched.body.data.validityGate.criteria as Array<{ key: string; met: boolean }>
      const byKey = Object.fromEntries(criteria.map((c) => [c.key, c.met] as const))
      expect(byKey).toMatchObject({ identifiable_patient: false, identifiable_reporter: false, suspect_product: true, adverse_event: true })
    })

    it('validityGate.allowed becomes true once identifying reporter/patient fields are present', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reporter: { reporterType: 'consumer', fullName: 'Jane Doe' }, patient: { initials: 'J.D.' } }))
        .expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${created.body.data.id}`), actor).expect(200)
      expect(fetched.body.data.validityGate.allowed).toBe(true)
    })

    it('blocks Intake → Triage with the validity-gate reason once a source document exists but identifying info is still missing', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string
      await linkAnySourceDocument(actor, caseId)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })
      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor)
        .send({ toStateKey: 'triage' })
        .expect(409)

      expect(blocked.body.error.code).toBe('TRANSITION_NOT_ALLOWED')
      expect(blocked.body.error.message).toMatch(/missing/i)
      expect(blocked.body.error.message).toMatch(/patient|reporter/i)
    })

    it('allows Intake → Triage once both the source-document and validity-gate guards pass', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'documents.manage'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reporter: { reporterType: 'consumer', fullName: 'Jane Doe' }, patient: { initials: 'J.D.' } }))
        .expect(201)
      const caseId = created.body.data.id as string
      await linkAnySourceDocument(actor, caseId)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({ where: { recordType: 'pv_case', recordId: caseId } })
      const allowed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), actor)
        .send({ toStateKey: 'triage' })
        .expect(201)

      expect(allowed.body.data.id).toBe(instance.id)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}`), actor).expect(200)
      expect(fetched.body.data.status).toBe('triage')

      // testing-todo Stage 17.1 — the case detail page's own Decision
      // History panel, real HTTP round trip: the real transition above
      // shows up in transitionHistory, sourced from the same audit-trail
      // mechanism Signal detail already used.
      expect(fetched.body.data.transitionHistory).toEqual([
        expect.objectContaining({ fromStateKey: 'intake', toStateKey: 'triage', actorName: expect.any(String) }),
      ])

      // Real-usage bug bash, 16 Aug 2026 — GET /pv/cases (the list) reads
      // Case.status directly, unlike GET /pv/cases/:id above (which already
      // read live workflow state); confirm the list reflects the real
      // transitioned status too, not the stale creation-time default.
      const list = await authed(request(httpServer(app)).get('/api/v1/pv/cases'), actor).expect(200)
      const row = (list.body.data as { id: string; status: string }[]).find((c) => c.id === caseId)
      expect(row?.status).toBe('triage')
    })
  })

  describe('Stage 5 — Triage & Seriousness', () => {
    it('classifies as non_serious and computes a real 30-day deadline when no seriousness flags are set', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string

      const classified = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)

      expect(classified.body.data.case.seriousnessClass).toBe('non_serious')
      expect(classified.body.data.deadlineUnavailable).toBe(false)
      expect(isoDate(new Date(classified.body.data.deadline.dueAt as string))).toBe(isoDate(addDays(new Date(awarenessDate), 30)))
    })

    it('auto-derives serious (15-day deadline) from a captured seriousness flag, then fatal (7-day) on reclassification', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ adverseEvents: [{ reportedTerm: 'Hospitalized', narrative: 'Hospitalized overnight', seriousnessHospitalization: true }] }))
        .expect(201)
      const caseId = created.body.data.id as string

      const first = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)
      expect(first.body.data.case.seriousnessClass).toBe('serious')
      const firstDueAt = first.body.data.deadline.dueAt as string
      expect(isoDate(new Date(firstDueAt))).toBe(isoDate(addDays(new Date(awarenessDate), 15)))

      // Reclassification — the same Deadline row is recomputed, not a second one created.
      const second = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor)
        .send({ seriousnessClass: 'fatal' })
        .expect(201)
      expect(second.body.data.case.seriousnessClass).toBe('fatal')
      expect(second.body.data.deadline.id).toBe(first.body.data.deadline.id)
      expect(isoDate(new Date(second.body.data.deadline.dueAt as string))).toBe(isoDate(addDays(new Date(awarenessDate), 7)))

      const deadlines = await withBypass((tx) => tx.deadline.findMany({ where: { companyId, recordType: 'pv_case', recordId: caseId } }))
      expect(deadlines).toHaveLength(1)
      expect(deadlines[0].status).toBe('recalculated')
    })

    it('classifies successfully but leaves the deadline unavailable for a report type with no active reporting rule yet', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
        .send(buildCasePayload({ reportTypeId: unverifiedReportTypeId }))
        .expect(201)
      const caseId = created.body.data.id as string

      const classified = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)

      expect(classified.body.data.case.seriousnessClass).toBe('non_serious')
      expect(classified.body.data.deadline).toBeNull()
      expect(classified.body.data.deadlineUnavailable).toBe(true)
    })

    it('401s unauthenticated, 403s an actor without pv.triage_case', async () => {
      const actor = await actorWith('DISPENSING_PHARMACIST', ['pv.capture_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string

      await request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`).send({}).expect(401)
      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(403)
    })

    it('audits the classification', async () => {
      const actor = await actorWith('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case'])
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor).send(buildCasePayload()).expect(201)
      const caseId = created.body.data.id as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/triage`), actor).send({}).expect(201)

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, recordId: caseId, action: 'pv_case_triaged' } })
      expect(auditEntries).toHaveLength(1)
    })
  })
})
