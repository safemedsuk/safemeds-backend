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
    channel: 'form',
    awarenessDate: '2026-08-01',
    receivedDate: '2026-08-02',
    reporter: { reporterType: 'consumer', fullName: 'Same Reporter', email: 'reporter@example.com' },
    patient: { initials: 'J.M.', ageYears: 34, sex: 'female' },
    suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Amoxil 500mg', activeSubstanceName: 'Amoxicillin' }],
    adverseEvents: [{ reportedTerm: 'Skin rash', narrative: 'Severe rash within two hours of dosing' }],
    ...overrides,
  }
}

describe('VigiCloud Stage 10/11 — Duplicate Linking & Case Follow-Up (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let definitionId: string
  let triageActor: TestActor

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
    await testPrisma.company.create({ data: { id: companyId, name: 'PV Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
    definitionId = randomUUID()
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

    await seedRoleWithPermissions('SUPERINTENDENT_PHARMACIST', ['pv.capture_case', 'pv.triage_case', 'pv.view_all', 'consent.manage'])
    triageActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SUPERINTENDENT_PHARMACIST'] })
  })

  async function createCase(overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), triageActor)
      .send(buildCasePayload(overrides, { reportTypeId, countryId }))
      .expect(201)
    return created.body.data.id as string
  }

  describe('Stage 10 — Duplicate Linking & Detection', () => {
    it('flags a possible duplicate at creation time when two cases share country/sex/age and a product/reaction overlap', async () => {
      const caseAId = await createCase()
      const caseBId = await createCase()

      const reviews = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseBId}/duplicate-reviews`), triageActor).expect(200)
      expect(reviews.body.data).toHaveLength(1)
      expect(reviews.body.data[0].status).toBe('possible')
      expect([reviews.body.data[0].caseId, reviews.body.data[0].matchedCaseId].sort()).toEqual([caseAId, caseBId].sort())

      // Never auto-merged — the guideline's own detection→confirmation split.
      const rawCases = await withBypass((tx) => tx.case.findMany({ where: { id: { in: [caseAId, caseBId] } } }))
      expect(rawCases.every((c) => c.duplicateOfCaseId === null)).toBe(true)
    })

    it('does not flag two cases in different countries, even with identical patient/product/reaction data', async () => {
      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'TZ', name: 'Tanzania' } })
      await createCase()
      const caseBId = await createCase({ countryOfOccurrenceId: otherCountryId })

      const reviews = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseBId}/duplicate-reviews`), triageActor).expect(200)
      expect(reviews.body.data).toHaveLength(0)
    })

    it('confirming as a duplicate (allocation pattern) sets the subordinate case\'s duplicateOfCaseId, real HTTP round-trip', async () => {
      const caseAId = await createCase()
      const caseBId = await createCase()
      const reviews = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseBId}/duplicate-reviews`), triageActor).expect(200)
      const reviewId = reviews.body.data[0].id as string

      const confirmed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/duplicate-reviews/${reviewId}/confirm`), triageActor)
        .send({ resolutionPattern: 'allocation', masterCaseId: caseAId, reviewNote: 'Same patient, same reaction — confirmed duplicate' })
        .expect(201)
      expect(confirmed.body.data.masterCaseId).toBe(caseAId)

      const rawCaseB = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseBId } }))
      expect(rawCaseB.duplicateOfCaseId).toBe(caseAId)
      const rawCaseA = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseAId } }))
      expect(rawCaseA.duplicateOfCaseId).toBeNull()

      const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, action: 'pv_duplicate_confirmed' } })
      expect(auditEntries).toHaveLength(1)
    })

    it('confirming as a duplicate (creation pattern) synthesizes a brand-new Master Case, real HTTP round-trip', async () => {
      const caseAId = await createCase()
      const caseBId = await createCase()
      const reviews = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseBId}/duplicate-reviews`), triageActor).expect(200)
      const reviewId = reviews.body.data[0].id as string

      const confirmed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/duplicate-reviews/${reviewId}/confirm`), triageActor)
        .send({ resolutionPattern: 'creation' })
        .expect(201)
      const masterCaseId = confirmed.body.data.masterCaseId as string
      expect([caseAId, caseBId]).not.toContain(masterCaseId)

      const master = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${masterCaseId}`), triageActor).expect(200)
      expect(master.body.data.suspectProducts).toHaveLength(2)
      expect(master.body.data.adverseEvents).toHaveLength(2)
      expect(master.body.data.causalityAssessments).toHaveLength(4)

      const rawCaseA = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseAId } }))
      const rawCaseB = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseBId } }))
      expect(rawCaseA.duplicateOfCaseId).toBe(masterCaseId)
      expect(rawCaseB.duplicateOfCaseId).toBe(masterCaseId)

      // Never deleted — both subordinate rows still exist, retained for audit trail.
      const stillExist = await withBypass((tx) => tx.case.findMany({ where: { id: { in: [caseAId, caseBId] } } }))
      expect(stillExist).toHaveLength(2)
    })

    it('dismissing documents a real "not a duplicate" decision and touches neither case', async () => {
      const caseAId = await createCase()
      const caseBId = await createCase()
      const reviews = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseBId}/duplicate-reviews`), triageActor).expect(200)
      const reviewId = reviews.body.data[0].id as string

      const dismissed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/duplicate-reviews/${reviewId}/dismiss`), triageActor)
        .send({ reviewNote: 'Different patients despite similar age/product — coincidence' })
        .expect(201)
      expect(dismissed.body.data.status).toBe('not_duplicate')
      expect(dismissed.body.data.reviewNote).toBe('Different patients despite similar age/product — coincidence')

      const rawCaseA = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseAId } }))
      const rawCaseB = await withBypass((tx) => tx.case.findUniqueOrThrow({ where: { id: caseBId } }))
      expect(rawCaseA.duplicateOfCaseId).toBeNull()
      expect(rawCaseB.duplicateOfCaseId).toBeNull()
    })
  })

  describe('Stage 11 — Case Follow-Up', () => {
    it('with contact consent granted: starts a follow-up cycle, opens an email attempt, and notifies staff via the real notification engine', async () => {
      const caseId = await createCase()
      await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), triageActor)
        .send({ recordType: 'pv_case', recordId: caseId, consentType: 'contact', granted: true, method: 'written' })
        .expect(201)

      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      expect(started.body.data.status).toBe('pending_attempt_1')
      expect(started.body.data.attempts).toHaveLength(1)
      expect(started.body.data.attempts[0].channel).toBe('email')
      expect(started.body.data.attempts[0].outcome).toBe('pending')

      const daysToClose = (new Date(started.body.data.closesByDate as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      expect(daysToClose).toBeGreaterThan(27.9)
      expect(daysToClose).toBeLessThan(28.1)

      // Real notification-engine round-trip — an in-app row for the
      // triage-permission-holding staff member, per Phase 9's real
      // create()/list() path, not mocked.
      const notifications = await authed(request(httpServer(app)).get('/api/v1/notifications'), triageActor).expect(200)
      const followUpNotifications = (notifications.body.data.rows as Array<{ category: string; recordId: string }>).filter((n) => n.category === 'case_follow_up' && n.recordId === caseId)
      expect(followUpNotifications.length).toBeGreaterThanOrEqual(1)

      const unread = await authed(request(httpServer(app)).get('/api/v1/notifications/unread-count'), triageActor).expect(200)
      expect(unread.body.data.count).toBeGreaterThanOrEqual(1)
    })

    it('testing-todo 11.1 — notifies the case\'s own captor with the reporter\'s contact details, and opens a real due-list Task', async () => {
      const caseId = await createCase()
      await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), triageActor)
        .send({ recordType: 'pv_case', recordId: caseId, consentType: 'contact', granted: true, method: 'written' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)

      // The notification body names the reporter directly — the original
      // report's own complaint was that the recipient had no way to know
      // who to actually contact.
      const notifications = await authed(request(httpServer(app)).get('/api/v1/notifications'), triageActor).expect(200)
      const followUpNotification = (notifications.body.data.rows as Array<{ category: string; recordId: string; body: string }>).find(
        (n) => n.category === 'case_follow_up' && n.recordId === caseId,
      )
      expect(followUpNotification?.body).toContain('Same Reporter')
      expect(followUpNotification?.body).toContain('reporter@example.com')

      // A real due-list Task, assigned to the case's own captor
      // (`triageActor` created the case via `createCase()`) — visible on
      // their own "Tasks for this record" / Task Inbox surface, not just
      // a notification that's easy to miss.
      const tasks = await authed(request(httpServer(app)).get(`/api/v1/tasks?recordId=${caseId}&scope=all`), triageActor).expect(200)
      const followUpTask = (tasks.body.data as Array<{ title: string; assignedUserId: string | null; status: string }>).find((t) => t.title.startsWith('Follow-up'))
      expect(followUpTask).toBeDefined()
      expect(followUpTask?.assignedUserId).toBe(triageActor.userId)
      expect(followUpTask?.status).toBe('open')
    })

    it('without contact consent: opens a phone-channel attempt instead — never contacts the reporter automatically', async () => {
      const caseId = await createCase()
      // Deliberately no consent capture call.

      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      expect(started.body.data.attempts[0].channel).toBe('phone')
    })

    it('logging responded_resolved closes the cycle, real HTTP round-trip through GET afterward', async () => {
      const caseId = await createCase()
      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      const followUpId = started.body.data.id as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/pv/case-follow-ups/${followUpId}/log-attempt`), triageActor)
        .send({ outcome: 'responded_resolved', note: 'Reporter confirmed full recovery by phone' })
        .expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(200)
      expect(fetched.body.data.status).toBe('closed_resolved')
      expect(fetched.body.data.attempts[0].note).toBe('Reporter confirmed full recovery by phone')
    })

    it('logging no_response twice escalates to attempt 2 then closes as failed', async () => {
      const caseId = await createCase()
      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      const followUpId = started.body.data.id as string

      const afterFirst = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/case-follow-ups/${followUpId}/log-attempt`), triageActor)
        .send({ outcome: 'no_response' })
        .expect(201)
      expect(afterFirst.body.data.status).toBe('pending_attempt_2')
      expect(afterFirst.body.data.attempts).toHaveLength(2)

      const afterSecond = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/case-follow-ups/${followUpId}/log-attempt`), triageActor)
        .send({ outcome: 'no_response' })
        .expect(201)
      expect(afterSecond.body.data.status).toBe('closed_failed')
    })

    it('is idempotent — starting a follow-up twice on the same case returns the same cycle', async () => {
      const caseId = await createCase()
      const first = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      const second = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${caseId}/follow-up`), triageActor).expect(201)
      expect(second.body.data.id).toBe(first.body.data.id)

      const attempts = await testPrisma.caseFollowUpAttempt.findMany({ where: { followUpId: first.body.data.id } })
      expect(attempts).toHaveLength(1)
    })
  })
})
