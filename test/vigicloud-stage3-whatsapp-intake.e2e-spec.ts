import { INestApplication } from '@nestjs/common'
import { createHmac, randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

const APP_SECRET = 'e2e-whatsapp-app-secret'
const VERIFY_TOKEN = 'e2e-whatsapp-verify-token'

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
}

function messagesPayload(phoneNumberId: string, from: string, text: string, profileName?: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001234', phone_number_id: phoneNumberId },
              contacts: profileName ? [{ profile: { name: profileName }, wa_id: from }] : undefined,
              messages: [{ from, id: `wamid.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  }
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
 * VigiCloud Stage 3.4 — real HTTP coverage for the WhatsApp Cloud API
 * webhook: GET handshake, POST signature verification, and a full
 * name → product → event → skip-photo scripted conversation across
 * several webhook calls, ending in a real draft case. Outbound replies
 * (`WhatsAppApiClient.sendText()`) genuinely hit `graph.facebook.com`
 * with a fake access token during this test and fail — that's expected
 * and confirms the best-effort contract (see `MailService`'s identical
 * pattern in the Stage 3.3 spec): a failed reply must never fail the
 * webhook request or break the conversation's state progression.
 */
describe('VigiCloud Stage 3.4 — WhatsApp Intake (e2e)', () => {
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
    await testPrisma.company.create({
      data: { id: companyId, name: 'WhatsApp Intake Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })
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

  it('503s the GET handshake and POST webhook on a server with no WhatsApp secrets configured', async () => {
    await request(httpServer(appUnconfigured)).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y').expect(503)

    const body = { object: 'whatsapp_business_account', entry: [] }
    await request(httpServer(appUnconfigured))
      .post('/api/v1/webhooks/whatsapp')
      .set('x-hub-signature-256', 'sha256=irrelevant')
      .send(body)
      .expect(503)
  })

  describe('with WhatsApp intake configured', () => {
    let appConfigured: INestApplication
    let phoneNumberId: string

    beforeAll(async () => {
      process.env.WHATSAPP_APP_SECRET = APP_SECRET
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN
      process.env.WHATSAPP_ACCESS_TOKEN = 'e2e-fake-access-token'
      appConfigured = await createTestApp()
    })

    afterAll(async () => {
      await appConfigured.close()
      delete process.env.WHATSAPP_APP_SECRET
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      delete process.env.WHATSAPP_ACCESS_TOKEN
    })

    beforeEach(async () => {
      phoneNumberId = `phone-${randomUUID()}`
      await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['company_profile.manage'])
      const actor = await createAuthenticatedActor(appConfigured, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
      await authedWrite(request(httpServer(appConfigured)).patch('/api/v1/company/whatsapp-phone-number-id'), actor)
        .send({ whatsappBusinessPhoneNumberId: phoneNumberId })
        .expect(200)
    })

    it('echoes hub.challenge back on a correct GET handshake, and 403s an incorrect one', async () => {
      const ok = await request(httpServer(appConfigured))
        .get(`/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=echo-me-123`)
        .expect(200)
      expect(ok.text).toBe('echo-me-123')

      await request(httpServer(appConfigured)).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x').expect(403)
    })

    it('400s a POST webhook whose signature does not verify', async () => {
      const body = messagesPayload(phoneNumberId, '254700000001', 'hi')
      await request(httpServer(appConfigured)).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', 'sha256=not-real').send(body).expect(400)
    })

    it('walks a full scripted conversation (name → product → event → skip photo) and creates a real, unconfirmed draft case', async () => {
      const waId = '254700000001'
      const server = httpServer(appConfigured)

      const turn1 = messagesPayload(phoneNumberId, waId, 'hi', 'Jane Reporter')
      await request(server).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(turn1)))).send(turn1).expect(201)

      const turn2 = messagesPayload(phoneNumberId, waId, 'Jane Doe')
      await request(server).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(turn2)))).send(turn2).expect(201)

      const turn3 = messagesPayload(phoneNumberId, waId, 'Amoxil 500mg')
      await request(server).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(turn3)))).send(turn3).expect(201)

      const turn4 = messagesPayload(phoneNumberId, waId, 'I broke out in hives')
      await request(server).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(turn4)))).send(turn4).expect(201)

      const rawCaseBeforePhoto = await withBypass((tx) => tx.case.findFirstOrThrow({ where: { companyId, channel: 'whatsapp_qr' } }))
      expect(rawCaseBeforePhoto.createdBy).toBeNull()
      expect(rawCaseBeforePhoto.requiresDraftReview).toBe(true)
      expect(rawCaseBeforePhoto.sourceChannelReference).toBe(waId)

      const turn5 = messagesPayload(phoneNumberId, waId, 'done')
      await request(server).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(turn5)))).send(turn5).expect(201)

      const rawReporter = await withBypass((tx) => tx.reporter.findFirstOrThrow({ where: { caseId: rawCaseBeforePhoto.id } }))
      expect(rawReporter.fullName).toBe('Jane Doe')
      expect(rawReporter.phone).toBe(waId)

      const rawProduct = await withBypass((tx) => tx.suspectProduct.findFirstOrThrow({ where: { caseId: rawCaseBeforePhoto.id } }))
      expect(rawProduct.medicinalProduct).toBe('Amoxil 500mg')

      // Visible in the same draft-review queue every Stage 3 channel shares.
      await seedRoleWithPermissions('QPPV', ['pv.triage_case', 'pv.view_all'])
      const triager = await createAuthenticatedActor(appConfigured, testPrisma, { companyId, roleKeys: ['QPPV'] })
      const queue = await request(server)
        .get('/api/v1/pv/cases?requiresDraftReview=true')
        .set('Cookie', triager.cookieHeader)
        .expect(200)
      const queueData = queue.body.data as Array<{ id: string }>
      expect(queueData.map((c) => c.id)).toContain(rawCaseBeforePhoto.id)
    })

    it('logs and no-ops for a webhook addressed to an unrecognized phone_number_id', async () => {
      const body = messagesPayload('unrecognized-phone-number-id', '254700000001', 'hi')
      await request(httpServer(appConfigured)).post('/api/v1/webhooks/whatsapp').set('x-hub-signature-256', sign(Buffer.from(JSON.stringify(body)))).send(body).expect(201)

      const cases = await withBypass((tx) => tx.case.findMany({ where: { companyId } }))
      expect(cases).toHaveLength(0)
    })
  })
})
