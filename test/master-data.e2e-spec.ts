import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

describe('Master data (e2e)', () => {
  let app: INestApplication
  let manager: TestActor
  let companyId: string
  let authorityId: string

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

  /** Mints a real, single-use re-auth signature token via the app's own signing path — same technique `workflow.e2e-spec.ts`/every RegCloud e2e spec already uses, since withdrawal is now signature-gated (testing-correction-explanation.md §3.6). */
  async function mintSignatureToken(actor: TestActor): Promise<string> {
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'Master Data Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })

    const roleId = randomUUID()
    await testPrisma.role.create({
      data: {
        id: roleId,
        key: 'REGULATORY_AFFAIRS_OFFICER',
        name: 'RA Officer',
        description: 'test fixture',
        isPlatform: false,
      },
    })
    const managePermissionId = randomUUID()
    await testPrisma.permission.create({
      data: { id: managePermissionId, key: 'master_data.manage', description: 'test fixture' },
    })
    const viewPermissionId = randomUUID()
    await testPrisma.permission.create({
      data: { id: viewPermissionId, key: 'master_data.view', description: 'test fixture' },
    })
    await testPrisma.rolePermission.createMany({
      data: [
        { roleId, permissionId: managePermissionId },
        { roleId, permissionId: viewPermissionId },
      ],
    })

    manager = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
    })
  })

  it('creates a product, lists it, searches it, and deactivates it (never deletes it)', async () => {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/products'), manager)
      .send({
        brandName: 'Amoxiclav',
        genericName: 'Amoxicillin/Clavulanate',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '500mg/125mg',
      })
      .expect(201)
    const productId = created.body.data.id as string
    expect(created.body.data.isActive).toBe(true)

    const searchRes = await authed(
      request(httpServer(app)).get('/api/v1/products?q=amox'),
      manager,
    ).expect(200)
    const searchRows = searchRes.body.data as { id: string }[]
    expect(searchRows.map((p) => p.id)).toContain(productId)

    const deactivateRes = await authedWrite(
      request(httpServer(app)).post(`/api/v1/products/${productId}/deactivate`),
      manager,
    ).expect(201)
    expect(deactivateRes.body.data.isActive).toBe(false)

    // still listed (never deleted) — just inactive
    const afterList = await authed(
      request(httpServer(app)).get('/api/v1/products'),
      manager,
    ).expect(200)
    const afterRows = afterList.body.data as { id: string; isActive: boolean }[]
    const found = afterRows.find((p) => p.id === productId)
    expect(found).toBeDefined()
    expect(found!.isActive).toBe(false)
  })

  it('creates a batch against a product and a registration against an authority', async () => {
    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), manager)
      .send({
        brandName: 'Paracet',
        genericName: 'Paracetamol',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '500mg',
      })
      .expect(201)
    const productId = product.body.data.id as string

    const batch = await authedWrite(request(httpServer(app)).post('/api/v1/batches'), manager)
      .send({
        productId,
        batchNumber: 'B-2026-001',
        manufacturedOn: '2026-01-01',
        expiresOn: '2028-01-01',
      })
      .expect(201)
    expect(batch.body.data.batchNumber).toBe('B-2026-001')

    const registration = await authedWrite(
      request(httpServer(app)).post('/api/v1/registrations'),
      manager,
    )
      .send({
        productId,
        authorityId,
        registrationNumber: 'PPB/REG/2026/001',
        issuedOn: '2026-01-01',
        expiresOn: '2026-12-31',
      })
      .expect(201)
    expect(registration.body.data.status).toBe('active')

    const nearExpiry = await authed(
      request(httpServer(app)).get('/api/v1/registrations?expiringWithinDays=400'),
      manager,
    ).expect(200)
    const nearExpiryRows = nearExpiry.body.data as { id: string }[]
    expect(nearExpiryRows.map((r) => r.id)).toContain(registration.body.data.id)

    const farExpiry = await authed(
      request(httpServer(app)).get('/api/v1/registrations?expiringWithinDays=1'),
      manager,
    ).expect(200)
    const farExpiryRows = farExpiry.body.data as { id: string }[]
    expect(farExpiryRows.map((r) => r.id)).not.toContain(registration.body.data.id)

    const withdrawn = await authedWrite(
      request(httpServer(app)).post(
        `/api/v1/registrations/${registration.body.data.id}/withdraw`,
      ),
      manager,
    )
      .send({
        reason: 'Product discontinued.',
        intentStatement: 'I withdraw this registration.',
        signatureToken: await mintSignatureToken(manager),
      })
      .expect(201)
    expect(withdrawn.body.data.status).toBe('withdrawn')
  })

  it("never returns another company's products (RLS isolation)", async () => {
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
    const otherActor = await createAuthenticatedActor(app, testPrisma, {
      companyId: otherCompanyId,
      roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
    })

    const created = await authedWrite(request(httpServer(app)).post('/api/v1/products'), manager)
      .send({
        brandName: 'CompanyASecret',
        genericName: 'Something',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '1mg',
      })
      .expect(201)

    const otherList = await authed(
      request(httpServer(app)).get('/api/v1/products'),
      otherActor,
    ).expect(200)
    const otherRows = otherList.body.data as { id: string }[]
    expect(otherRows.map((p) => p.id)).not.toContain(created.body.data.id)
  })

  it('401s/403s for unauthenticated or under-permissioned actors', async () => {
    await request(httpServer(app)).post('/api/v1/products').send({}).expect(401)

    const viewer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [] })
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/products'), viewer)
      .send({
        brandName: 'x',
        genericName: 'y',
        productCategory: 'medicinal',
        dosageForm: 'tablet',
        strength: '1mg',
      })
      .expect(403)
    expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS')
  })
})

describe('MedDRA search (e2e)', () => {
  let app: INestApplication
  let actor: TestActor

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    actor = await createAuthenticatedActor(app, testPrisma, {})

    const versionId = randomUUID()
    await testPrisma.meddraVersion.create({
      data: { id: versionId, versionLabel: 'TEST-1.0', releasedOn: new Date('2026-01-01') },
    })
    const socId = randomUUID()
    await testPrisma.meddraTerm.create({
      data: { id: socId, versionId, code: 'S1', level: 'SOC', name: 'Skin disorders' },
    })
    await testPrisma.meddraTerm.create({
      data: { id: randomUUID(), versionId, code: 'P1', level: 'PT', name: 'Rash', parentId: socId },
    })
    await testPrisma.meddraTerm.create({
      data: {
        id: randomUUID(),
        versionId,
        code: 'P2',
        level: 'PT',
        name: 'Rash pruritic',
        parentId: socId,
      },
    })
  })

  it('typeahead-searches term names case-insensitively', async () => {
    const res = await request(httpServer(app))
      .get('/api/v1/meddra/search?q=rash')
      .set('Cookie', actor.cookieHeader)
      .expect(200)

    expect(res.body.data).toHaveLength(2)
    const rows = res.body.data as { name: string }[]
    expect(rows.map((t) => t.name).sort()).toEqual(['Rash', 'Rash pruritic'])
  })

  it('filters by level', async () => {
    const res = await request(httpServer(app))
      .get('/api/v1/meddra/search?q=disorders&level=SOC')
      .set('Cookie', actor.cookieHeader)
      .expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Skin disorders')
  })
})
