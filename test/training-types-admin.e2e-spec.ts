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

async function seedRole(roleKey: string, permissionKeys: string[], isPlatform = true): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform },
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
 * Special Corner SC-8 (Admin Configuration Console — training-type
 * catalog, todo-vigicloud.md 16.6-A): "PPB Academy" only makes sense
 * for a Kenya-market company — this proves the real end-to-end
 * mechanism, not just the mocked unit-test harness: a country-scoped
 * entry only shows up for a tenant in that market, generic entries
 * show up for everyone, and only `platform.config.manage` can write.
 */
describe('Training-type catalog admin (e2e)', () => {
  let app: INestApplication
  let kenyaId: string
  let ugandaId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    kenyaId = randomUUID()
    await testPrisma.country.create({ data: { id: kenyaId, isoCode: 'KE', name: 'Kenya' } })
    ugandaId = randomUUID()
    await testPrisma.country.create({ data: { id: ugandaId, isoCode: 'UG', name: 'Uganda' } })
  })

  async function configManager(): Promise<TestActor> {
    await seedRole('regulatory_lead', ['platform.config.manage'])
    return createAuthenticatedActor(app, testPrisma, { platformRole: 'regulatory_lead' })
  }

  async function noPermsActor(): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { platformRole: 'support' })
  }

  async function tenantInCountry(homeCountryId: string): Promise<TestActor> {
    const companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'E2E Tenant', companyType: 'manufacturer', homeCountryId, status: 'active' } })
    return createAuthenticatedActor(app, testPrisma, { roleKeys: [], companyId })
  }

  it('creates a country-scoped and a generic training type, and GET returns both for a tenant in that market', async () => {
    const admin = await configManager()

    const scoped = await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({
      countryId: kenyaId,
      typeKey: 'ppb_academy',
      label: 'PPB Academy',
      sortOrder: 1,
    })
    expect(scoped.status).toBe(201)

    const generic = await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({
      typeKey: 'internal',
      label: 'Internal',
      sortOrder: 100,
    })
    expect(generic.status).toBe(201)
    expect(generic.body.data.countryId).toBeNull()

    const tenant = await tenantInCountry(kenyaId)

    const list = await authed(request(httpServer(app)).get('/api/v1/training-types'), tenant)
    expect(list.status).toBe(200)
    const keys = (list.body.data as { typeKey: string }[]).map((t) => t.typeKey)
    expect(keys).toContain('ppb_academy')
    expect(keys).toContain('internal')
  })

  it('a training type scoped to a different country is NOT returned for a tenant in this one', async () => {
    const admin = await configManager()
    await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({
      countryId: ugandaId,
      typeKey: 'uganda_only_type',
      label: 'Uganda-only Type',
    })

    const kenyaTenant = await tenantInCountry(kenyaId)

    const list = await authed(request(httpServer(app)).get('/api/v1/training-types'), kenyaTenant)
    const keys = (list.body.data as { typeKey: string }[]).map((t) => t.typeKey)
    expect(keys).not.toContain('uganda_only_type')
  })

  it('rejects creating a training type without platform.config.manage', async () => {
    const actor = await noPermsActor()
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), actor).send({ typeKey: 'x', label: 'X' })
    expect(res.status).toBe(403)
  })

  it('rejects a duplicate (countryId, typeKey) pair with a real 409', async () => {
    const admin = await configManager()
    await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({ countryId: kenyaId, typeKey: 'dup', label: 'First' }).expect(201)

    const res = await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({ countryId: kenyaId, typeKey: 'dup', label: 'Second' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TRAINING_TYPE_ALREADY_EXISTS')
  })

  it('updates a training type\'s label/active flag and the change is reflected on the next read', async () => {
    const admin = await configManager()
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/training-types'), admin).send({ countryId: kenyaId, typeKey: 'gvp_certificate', label: 'GVP Cert' })

    const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/training-types/${created.body.data.id}`), admin).send({ label: 'GVP Certificate (Full)', active: false })
    expect(updated.status).toBe(200)
    expect(updated.body.data.label).toBe('GVP Certificate (Full)')
    expect(updated.body.data.active).toBe(false)
  })
})
