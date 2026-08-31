import { INestApplication } from '@nestjs/common'
import { createHmac, randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

const SECRET = `whsec_${Buffer.from('e2e-test-signing-key-32-bytes-lo').toString('base64')}`

function sign(id: string, timestamp: string, body: string): string {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${digest}`
}

function signedHeaders(body: object) {
  const raw = JSON.stringify(body)
  const id = `msg_${randomUUID()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': sign(id, timestamp, raw) }
}

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
 * VigiCloud Stage 3.3 — real HTTP coverage for the inbound-email intake
 * webhook. `ConfigService.get()` re-reads live `process.env` on every
 * call rather than trusting a frozen boot-time snapshot, and
 * `process.env` is a single object shared by every app instance in this
 * process — so the "not configured" case is covered by its own app,
 * created and exercised *before* the nested "configured" describe block's
 * `beforeAll` ever mutates `process.env` (Jest runs hooks/tests in file
 * declaration order, lazily per scope), rather than by two apps that
 * coexist for the whole file.
 */
describe('VigiCloud Stage 3.3 — Inbound Email Intake (e2e)', () => {
  let appUnconfigured: INestApplication
  let companyId: string
  let countryId: string

  beforeAll(async () => {
    appUnconfigured = await createTestApp()
  })

  afterAll(async () => {
    await appUnconfigured.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Email Intake Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    await testPrisma.reportType.create({ data: { id: randomUUID(), typeKey: 'adr', moduleKey: 'pv', name: 'Suspected ADR' } })

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

  it('503s the webhook on a server with no RESEND_INBOUND_WEBHOOK_SECRET configured', async () => {
    const body = { type: 'email.received', data: { from: 'a@b.com', to: 'whoever@intake.safemeds.test' } }
    await request(httpServer(appUnconfigured)).post('/api/v1/webhooks/inbound-email').set(signedHeaders(body)).send(body).expect(503)
  })

  describe('with email intake configured', () => {
    let appConfigured: INestApplication

    beforeAll(async () => {
      process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET
      process.env.EMAIL_INTAKE_DOMAIN = 'intake.safemeds.test'
      appConfigured = await createTestApp()
    })

    afterAll(async () => {
      await appConfigured.close()
      delete process.env.RESEND_INBOUND_WEBHOOK_SECRET
      delete process.env.EMAIL_INTAKE_DOMAIN
    })

    async function generateIntakeEmail(): Promise<string> {
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['company_profile.manage'])
      const actor = await createAuthenticatedActor(appConfigured, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
      const generated = await authedWrite(request(httpServer(appConfigured)).post('/api/v1/company/intake-email'), actor).expect(201)
      return generated.body.data.intakeEmailAddress as string
    }

    it('400s a webhook whose signature does not verify', async () => {
      const body = { type: 'email.received', data: { from: 'a@b.com', to: 'whoever@intake.safemeds.test' } }
      await request(httpServer(appConfigured))
        .post('/api/v1/webhooks/inbound-email')
        .set('svix-id', 'msg-1')
        .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
        .set('svix-signature', 'v1,not-a-real-signature')
        .send(body)
        .expect(400)
    })

    it('a correctly signed webhook with all minimum-criteria fields creates a real, unconfirmed draft case addressed to the generated intake email', async () => {
      const intakeEmail = await generateIntakeEmail()

      const body = {
        type: 'email.received',
        data: {
          from: 'Jane Reporter <jane.reporter@example.com>',
          to: intakeEmail,
          subject: 'Bad reaction to Amoxil',
          text: 'Patient Age: 34\nPatient Sex: Female\nProduct: Amoxil 500mg\nAdverse Event: Severe rash within two hours of the first dose',
          messageId: '<abc123@mail.example.com>',
        },
      }

      const response = await request(httpServer(appConfigured)).post('/api/v1/webhooks/inbound-email').set(signedHeaders(body)).send(body).expect(201)
      expect(response.body.data).toEqual({ outcome: 'case_created', referenceNumber: expect.stringMatching(/^PV-\d{4}-\d{5}$/) })

      const rawCase = await withBypass((tx) => tx.case.findFirstOrThrow({ where: { companyId, referenceNumber: response.body.data.referenceNumber as string } }))
      expect(rawCase.createdBy).toBeNull()
      expect(rawCase.requiresDraftReview).toBe(true)
      expect(rawCase.channel).toBe('drug_safety_email')
      expect(rawCase.sourceChannelReference).toBe('<abc123@mail.example.com>')

      const rawReporter = await withBypass((tx) => tx.reporter.findFirstOrThrow({ where: { caseId: rawCase.id } }))
      expect(rawReporter.email).toBe('jane.reporter@example.com')

      // Visible in the same draft-review queue Stage 3.2's public-URL cases land in.
      await seedRoleWithPermissions('QPPV', ['pv.triage_case', 'pv.view_all'])
      const triager = await createAuthenticatedActor(appConfigured, testPrisma, { companyId, roleKeys: ['QPPV'] })
      const queue = await authed(request(httpServer(appConfigured)).get('/api/v1/pv/cases?requiresDraftReview=true'), triager).expect(200)
      const queueData = queue.body.data as Array<{ id: string }>
      expect(queueData.map((c) => c.id)).toContain(rawCase.id)
    })

    it('sends an automated follow-up (no case created) when minimum-criteria fields are not extractable from the email body', async () => {
      const intakeEmail = await generateIntakeEmail()

      const body = {
        type: 'email.received',
        data: { from: 'jane.reporter@example.com', to: intakeEmail, subject: 'Question', text: 'Hi, I felt a bit off after taking something yesterday.' },
      }

      const response = await request(httpServer(appConfigured)).post('/api/v1/webhooks/inbound-email').set(signedHeaders(body)).send(body).expect(201)
      expect(response.body.data).toEqual({ outcome: 'follow_up_sent' })

      const cases = await withBypass((tx) => tx.case.findMany({ where: { companyId } }))
      expect(cases).toHaveLength(0)
    })

    it('logs and no-ops (does not create a case) for a webhook addressed to an unrecognized intake address', async () => {
      const body = { type: 'email.received', data: { from: 'a@b.com', to: 'no-such-company@intake.safemeds.test', text: 'anything' } }
      const response = await request(httpServer(appConfigured)).post('/api/v1/webhooks/inbound-email').set(signedHeaders(body)).send(body).expect(201)
      expect(response.body.data).toEqual({ outcome: 'unrecognized_recipient' })
    })
  })
})
