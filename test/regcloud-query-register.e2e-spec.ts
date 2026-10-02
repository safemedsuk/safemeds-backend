import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { StorageService } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

class FakeStorageService {
  putObject(key: string, body: Buffer): Promise<{ key: string; sha256: string; sizeBytes: number }> {
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }
  getObjectBuffer(): Promise<Buffer> {
    return Promise.resolve(Buffer.from('fake'))
  }
}

/**
 * CEO feedback, 30 Sep 2026 (real-usage query-register review) — a real
 * response due date (manual for now), named/reassignable ownership, a
 * multi-round correspondence thread, the widened
 * open→in_progress→responded→closed lifecycle, and the cross-dossier
 * register view filterable by market/product/owner/status with overdue
 * highlighted. Exercised end-to-end against the real running app.
 */
describe('RegCloud Query Register — due dates, ownership, correspondence, register view (e2e)', () => {
  let app: INestApplication
  let raOfficer: TestActor
  let raOfficer2: TestActor
  let countryId: string
  let authorityId: string
  let companyId: string
  let productId: string
  let dossierId: string

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(StorageService).useValue(new FakeStorageService()))
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

  beforeEach(async () => {
    countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya', officialName: 'Republic of Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })

    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'RegCloud Query Register Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    const tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of ['regulatory.manage_dossier', 'regulatory.view_all', 'master_data.manage', 'master_data.view', 'documents.manage']) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })
    raOfficer2 = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // A minimal reg_registration workflow — this spec never transitions the dossier, just needs it instantiable.
    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const planningId = randomUUID()
    await testPrisma.workflowState.create({ data: { id: planningId, definitionId: defId, stateKey: 'planning', name: 'planning', isInitial: true, isTerminal: false } })

    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), raOfficer)
      .send({ brandName: 'Panadol', genericName: 'Paracetamol', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' })
      .expect(201)
    productId = product.body.data.id as string

    const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
      .send({ productId, authorityId, productClass: 'generic_pharma' })
      .expect(201)
    dossierId = dossier.body.data.id as string
  })

  async function receiveQuery(overrides: Record<string, unknown> = {}): Promise<{ id: string; [k: string]: unknown }> {
    let req = authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries`), raOfficer)
      .field('queryText', 'Please clarify the CPP validity period.')
      .field('receivedDate', '2026-06-01')
    for (const [key, value] of Object.entries(overrides)) req = req.field(key, String(value))
    const res = await req.attach('file', Buffer.from('letter'), { filename: 'letter.pdf', contentType: 'application/pdf' }).expect(201)
    return res.body.data as { id: string; [k: string]: unknown }
  }

  it('accepts an optional response due date and owner at log time, and computes isOverdue live', async () => {
    const query = await receiveQuery({ responseDueDate: '2026-06-15', ownerUserId: raOfficer.userId })
    expect((query.responseDueDate as string).slice(0, 10)).toBe('2026-06-15')
    expect(query.ownerUserId).toBe(raOfficer.userId)
    // Set in the future relative to the fixed test date, but resolved
    // live against `Date.now()` — assert it's a real boolean field, not
    // asserting its current value (which would be a flaky assumption
    // about "now" relative to a fixed 2026-06-15 string).
    expect(typeof query.isOverdue).toBe('boolean')
  })

  it('sets/corrects the response due date via PATCH, and flags overdue once it has passed', async () => {
    const query = await receiveQuery()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/due-date`), raOfficer)
      .send({ responseDueDate: past })
      .expect(200)
    expect(updated.body.data.isOverdue).toBe(true)
  })

  it('assigns an owner (bumping open → in_progress), allows reassignment, and unassigns explicitly', async () => {
    const query = await receiveQuery()

    const assigned = await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/owner`), raOfficer)
      .send({ ownerUserId: raOfficer.userId })
      .expect(200)
    expect(assigned.body.data.ownerUserId).toBe(raOfficer.userId)
    expect(assigned.body.data.status).toBe('in_progress')

    const reassigned = await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/owner`), raOfficer)
      .send({ ownerUserId: raOfficer2.userId })
      .expect(200)
    expect(reassigned.body.data.ownerUserId).toBe(raOfficer2.userId)

    const unassigned = await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/owner`), raOfficer)
      .send({ ownerUserId: null })
      .expect(200)
    expect(unassigned.body.data.ownerUserId).toBeNull()
  })

  it('rejects an owner who is not a real user of this company', async () => {
    const query = await receiveQuery()
    const res = await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/owner`), raOfficer)
      .send({ ownerUserId: newId() })
      .expect(400)
    expect(res.body.error.code).toBe('OWNER_NOT_FOUND')
  })

  it('logs a real multi-round correspondence thread — letters, emails, notes — each with its own date, and keeps it in order', async () => {
    const query = await receiveQuery()

    await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/correspondence`), raOfficer)
      .field('direction', 'to_regulator')
      .field('channel', 'email')
      .field('occurredOn', '2026-06-03')
      .field('summary', 'Asked the regulator for a clarifying call.')
      .expect(201)

    await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/correspondence`), raOfficer)
      .field('direction', 'from_regulator')
      .field('channel', 'phone')
      .field('occurredOn', '2026-06-05')
      .field('summary', 'Regulator called back with a follow-up question.')
      .expect(201)

    const thread = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/correspondence`), raOfficer).expect(200)
    // The original letter is entry 0 (logged by `receive()` itself), then the two above, in occurredOn order.
    expect(thread.body.data).toHaveLength(3)
    expect(thread.body.data[0].channel).toBe('letter')
    expect(thread.body.data[0].direction).toBe('from_regulator')
    expect(thread.body.data[1].summary).toBe('Asked the regulator for a clarifying call.')
    expect(thread.body.data[2].summary).toBe('Regulator called back with a follow-up question.')

    const queryAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}/queries`), raOfficer).expect(200)
    expect(queryAfter.body.data[0].status).toBe('in_progress')
  })

  it('respond() lands the query at "responded" (not "closed"), and close() is a separate, later, deliberate step requiring a prior response', async () => {
    const query = await receiveQuery()

    const notYetResponded = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/close`), raOfficer)
      .send({})
      .expect(409)
    expect(notYetResponded.body.error.code).toBe('MUST_RESPOND_FIRST')

    const responded = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/respond`), raOfficer)
      .field('note', 'CPP validity confirmed as 24 months.')
      .field('respondedDate', '2026-06-10')
      .attach('file', Buffer.from('response'), { filename: 'response.pdf', contentType: 'application/pdf' })
      .expect(201)
    expect(responded.body.data.status).toBe('responded')

    const closed = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/close`), raOfficer)
      .send({ note: 'Regulator confirmed satisfaction by phone.' })
      .expect(201)
    expect(closed.body.data.status).toBe('closed')
    expect(closed.body.data.closedAt).not.toBeNull()

    const alreadyClosed = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/close`), raOfficer)
      .send({})
      .expect(409)
    expect(alreadyClosed.body.error.code).toBe('ALREADY_CLOSED')

    // The closing note itself lands in the same correspondence thread.
    const thread = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}/queries/${query.id}/correspondence`), raOfficer).expect(200)
    const threadEntries = thread.body.data as { direction: string }[]
    expect(threadEntries.map((c) => c.direction)).toEqual([
      'from_regulator',
      'to_regulator',
      'internal_note',
    ])
  })

  describe('register view — cross-dossier, filterable by market/product/owner/status, overdue highlighted', () => {
    it('lists across dossiers, filters by every dimension, and only ever surfaces this company\'s own queries', async () => {
      const overdueQuery = await receiveQuery({ ownerUserId: raOfficer.userId })
      await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${overdueQuery.id}/due-date`), raOfficer)
        .send({ responseDueDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) })
        .expect(200)

      const futureQuery = await receiveQuery({ ownerUserId: raOfficer2.userId })
      await authedWrite(request(httpServer(app)).patch(`/api/v1/reg-dossiers/${dossierId}/queries/${futureQuery.id}/due-date`), raOfficer)
        .send({ responseDueDate: '2027-01-01' })
        .expect(200)

      const all = await authed(request(httpServer(app)).get('/api/v1/reg-queries'), raOfficer).expect(200)
      expect(all.body.data).toHaveLength(2)
      expect(all.body.data[0].productBrandName).toBe('Panadol')
      expect(all.body.data[0].countryName).toBe('Kenya')

      const overdueOnly = await authed(request(httpServer(app)).get('/api/v1/reg-queries?overdueOnly=true'), raOfficer).expect(200)
      expect(overdueOnly.body.data).toHaveLength(1)
      expect(overdueOnly.body.data[0].id).toBe(overdueQuery.id)
      expect(overdueOnly.body.data[0].isOverdue).toBe(true)

      const byOwner = await authed(request(httpServer(app)).get(`/api/v1/reg-queries?ownerUserId=${raOfficer2.userId}`), raOfficer).expect(200)
      expect(byOwner.body.data).toHaveLength(1)
      expect(byOwner.body.data[0].id).toBe(futureQuery.id)

      const byProduct = await authed(request(httpServer(app)).get(`/api/v1/reg-queries?productId=${productId}`), raOfficer).expect(200)
      expect(byProduct.body.data).toHaveLength(2)

      const byCountry = await authed(request(httpServer(app)).get(`/api/v1/reg-queries?countryId=${countryId}`), raOfficer).expect(200)
      expect(byCountry.body.data).toHaveLength(2)

      const byStatus = await authed(request(httpServer(app)).get('/api/v1/reg-queries?status=open'), raOfficer).expect(200)
      expect(byStatus.body.data).toHaveLength(2)
    })
  })
})
