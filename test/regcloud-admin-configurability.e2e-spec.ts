import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * RegCloud Admin Configurability checklist item 4 — the `ProductClassDefinition`
 * admin surface: real HTTP coverage of list/create/update against the
 * running app, mirroring `training-types.e2e-spec.ts`'s own shape for the
 * closely-analogous `TrainingTypeCatalogEntry` (open GET, gated
 * POST/PATCH, service-enforced duplicate check across a nullable scope
 * column).
 */
describe('RegCloud Admin Configurability — Product Class taxonomy (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let tenantActor: TestActor
  let countryId: string
  let authorityId: string
  let secondAuthorityId: string

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

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya', officialName: 'Republic of Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })
    secondAuthorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: secondAuthorityId, countryId, code: 'NDA', name: 'National Drug Authority' } })

    const platformRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true } })
    const platformPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: platformPermissionId, key: 'platform.config.manage', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: platformPermissionId } })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

    const companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Admin Config Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    tenantActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [] })
  })

  it('lists an empty catalog for a brand-new authority', async () => {
    const res = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${authorityId}`), tenantActor).expect(200)
    expect(res.body.data).toEqual([])
  })

  it('403s a tenant actor attempting to create a product class', async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), tenantActor)
      .send({ authorityId, classKey: 'medicines', label: 'Medicines' })
      .expect(403)
  })

  it('a platform admin creates a product class, and any authenticated user can then list it', async () => {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin)
      .send({ authorityId, classKey: 'medicines', label: 'Medicines', sourceReference: 'SafeMeds_Regulatory_Workflow_Map.pdf' })
      .expect(201)

    expect(created.body.data.classKey).toBe('medicines')
    expect(created.body.data.active).toBe(true)

    const listed = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${authorityId}`), tenantActor).expect(200)
    expect(listed.body.data).toHaveLength(1)
    expect(listed.body.data[0].classKey).toBe('medicines')
  })

  it('a class created against one authority never appears when listing a different authority', async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ authorityId, classKey: 'medicines', label: 'Medicines' }).expect(201)

    const listedOther = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${secondAuthorityId}`), tenantActor).expect(200)
    expect(listedOther.body.data).toEqual([])
  })

  it('a generic (no authorityId) class appears under every authority\'s own list', async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ classKey: 'generic_pharma', label: 'Generic Pharmaceutical' }).expect(201)

    const listedFirst = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${authorityId}`), tenantActor).expect(200)
    const listedSecond = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${secondAuthorityId}`), tenantActor).expect(200)
    expect((listedFirst.body.data as { classKey: string }[]).map((c) => c.classKey)).toContain('generic_pharma')
    expect((listedSecond.body.data as { classKey: string }[]).map((c) => c.classKey)).toContain('generic_pharma')
  })

  it('rejects a duplicate (authorityId, classKey) pair with a real 409', async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ authorityId, classKey: 'medicines', label: 'Medicines' }).expect(201)

    await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ authorityId, classKey: 'medicines', label: 'Medicines (dup)' }).expect(409)
  })

  it('an inactive class is excluded from the default list but returned with includeInactive=true', async () => {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ authorityId, classKey: 'medicines', label: 'Medicines' }).expect(201)

    await authedWrite(request(httpServer(app)).patch(`/api/v1/product-classes/${created.body.data.id}`), admin).send({ active: false }).expect(200)

    const activeOnly = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${authorityId}`), tenantActor).expect(200)
    expect(activeOnly.body.data).toEqual([])

    const withInactive = await authed(request(httpServer(app)).get(`/api/v1/product-classes?authorityId=${authorityId}&includeInactive=true`), tenantActor).expect(200)
    expect(withInactive.body.data).toHaveLength(1)
    expect(withInactive.body.data[0].active).toBe(false)
  })

  it("classKey/authorityId aren't accepted PATCH fields at all — the global ValidationPipe's forbidNonWhitelisted rejects a body that even includes them, matching RequirementDefinitionAdminService's own established precedent", async () => {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/product-classes'), admin).send({ authorityId, classKey: 'medicines', label: 'Medicines' }).expect(201)

    await authedWrite(request(httpServer(app)).patch(`/api/v1/product-classes/${created.body.data.id}`), admin)
      .send({ label: 'Medicines (Human Use)', classKey: 'attempted_override' })
      .expect(400)

    const patched = await authedWrite(request(httpServer(app)).patch(`/api/v1/product-classes/${created.body.data.id}`), admin).send({ label: 'Medicines (Human Use)' }).expect(200)

    expect(patched.body.data.classKey).toBe('medicines')
    expect(patched.body.data.authorityId).toBe(authorityId)
    expect(patched.body.data.label).toBe('Medicines (Human Use)')
  })
})
