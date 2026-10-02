import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * testing-correction-explanation.md §4.1 — Regulatory Entities bulk
 * import (Manufacturers, Manufacturing Sites, Local Representatives),
 * exercised end-to-end against the real running app and a real Postgres
 * database — mirroring `regcloud-stage0.e2e-spec.ts`'s own tenant
 * fixture shape (Manufacturer/ManufacturingSite/LocalRepresentative
 * CRUD is the same Stage 0.2 surface this import ultimately calls
 * through `RegEntitiesService`).
 */
describe('RegCloud Phase 4.1 — Regulatory Entities Bulk Import (e2e)', () => {
  let app: INestApplication
  let raOfficer: TestActor
  let underPermissioned: TestActor
  let companyId: string
  let kenyaId: string
  let indiaId: string

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
    kenyaId = randomUUID()
    await testPrisma.country.create({ data: { id: kenyaId, isoCode: 'KE', name: 'Kenya' } })
    indiaId = randomUUID()
    await testPrisma.country.create({ data: { id: indiaId, isoCode: 'IN', name: 'India' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'Reg Entities Import Test Co', companyType: 'manufacturer', homeCountryId: kenyaId, status: 'active' },
    })

    const tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of ['regulatory.manage_entities', 'regulatory.view_all']) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    const noPermRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: noPermRoleId, key: 'EXECUTIVE_READONLY', name: 'Exec Readonly', description: 'test fixture', isPlatform: false } })
    underPermissioned = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
  })

  describe('preview', () => {
    it('validates manufacturers, resolves a site\'s manufacturerKey against the same batch, and validates local representatives independently', async () => {
      const preview = await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/preview'), raOfficer)
        .send({
          manufacturersCsv: 'manufacturerKey,name,country\nMFG-001,Acme Pharmaceuticals,Kenya\nMFG-002,Global Meds,\n,Missing Key Co',
          sitesCsv: 'manufacturerKey,siteName,country\nMFG-001,Nairobi Plant,KE\nGhost Co,Unknown Plant',
          localRepresentativesCsv: 'name,contactEmail\nKenya Reg Partners,ops@kenyareg.co.ke\n,\nAnother Rep,not-an-email',
        })
        .expect(201)

      expect(preview.body.data.manufacturers.validRows).toHaveLength(2)
      expect(preview.body.data.manufacturers.invalidRows).toHaveLength(1)
      expect(preview.body.data.manufacturers.invalidRows[0].errors).toContain('Manufacturer Key is required')

      expect(preview.body.data.sites.validRows).toHaveLength(1)
      expect(preview.body.data.sites.invalidRows).toHaveLength(1)
      expect(preview.body.data.sites.invalidRows[0].errors[0]).toMatch(/does not match any manufacturer/)

      expect(preview.body.data.localRepresentatives.validRows).toHaveLength(1)
      expect(preview.body.data.localRepresentatives.invalidRows).toHaveLength(2)
    })

    it('flags an unrecognized country instead of silently ignoring it', async () => {
      const preview = await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/preview'), raOfficer)
        .send({ manufacturersCsv: 'manufacturerKey,name,country\nMFG-001,Acme Pharmaceuticals,Narnia' })
        .expect(201)

      expect(preview.body.data.manufacturers.invalidRows).toHaveLength(1)
      expect(preview.body.data.manufacturers.invalidRows[0].errors[0]).toMatch(/Country "Narnia" is not recognized/)
    })

    it('a site row can also resolve against an already-cataloged manufacturer by name, not just the same batch', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/manufacturers'), raOfficer)
        .send({ name: 'Already Cataloged Co' })
        .expect(201)

      const preview = await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/preview'), raOfficer)
        .send({ sitesCsv: 'manufacturerKey,siteName\nAlready Cataloged Co,Second Plant' })
        .expect(201)

      expect(preview.body.data.sites.validRows).toHaveLength(1)
    })

    it('403s for an actor without regulatory.manage_entities', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/preview'), underPermissioned)
        .send({ manufacturersCsv: 'manufacturerKey,name\nMFG-001,Acme' })
        .expect(403)
    })
  })

  describe('commit', () => {
    it('imports manufacturers, then sites resolved against them, then local representatives, all tenant-scoped and real', async () => {
      const result = await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/commit'), raOfficer)
        .send({
          manufacturers: [
            { manufacturerKey: 'MFG-001', name: 'Acme Pharmaceuticals', country: 'KE' },
            { manufacturerKey: 'MFG-002', name: 'Global Meds', country: 'India' },
          ],
          sites: [
            { manufacturerKey: 'MFG-001', siteName: 'Nairobi Plant', gmpCertificateNumber: 'GMP-2026-001' },
            { manufacturerKey: 'MFG-002', siteName: 'Ahmedabad Plant' },
          ],
          localRepresentatives: [{ name: 'Kenya Reg Partners', contactEmail: 'ops@kenyareg.co.ke' }],
        })
        .expect(201)

      expect(result.body.data.manufacturers.committed).toBe(2)
      expect(result.body.data.sites.committed).toBe(2)
      expect(result.body.data.localRepresentatives.committed).toBe(1)

      const manufacturers = await authed(request(httpServer(app)).get('/api/v1/manufacturers'), raOfficer).expect(200)
      const rows = manufacturers.body.data as { id: string; name: string; countryId: string | null }[]
      const acme = rows.find((m) => m.name === 'Acme Pharmaceuticals')!
      expect(acme).toBeDefined()
      expect(acme.countryId).toBe(kenyaId)
      const globalMeds = rows.find((m) => m.name === 'Global Meds')!
      expect(globalMeds.countryId).toBe(indiaId)

      const sites = await authed(request(httpServer(app)).get(`/api/v1/manufacturing-sites?manufacturerId=${acme.id}`), raOfficer).expect(200)
      expect((sites.body.data as { siteName: string }[]).map((s) => s.siteName)).toContain('Nairobi Plant')

      const localReps = await authed(request(httpServer(app)).get('/api/v1/local-representatives'), raOfficer).expect(200)
      expect((localReps.body.data as { name: string }[]).map((r) => r.name)).toContain('Kenya Reg Partners')
    })

    it('never creates a duplicate manufacturer for a name that already exists in the catalog', async () => {
      const existing = await authedWrite(request(httpServer(app)).post('/api/v1/manufacturers'), raOfficer)
        .send({ name: 'Acme Pharmaceuticals' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/commit'), raOfficer)
        .send({ manufacturers: [{ manufacturerKey: 'MFG-001', name: 'acme pharmaceuticals' }] })
        .expect(201)

      const manufacturers = await authed(request(httpServer(app)).get('/api/v1/manufacturers'), raOfficer).expect(200)
      const rows = manufacturers.body.data as { id: string; name: string }[]
      expect(rows.filter((m) => m.id === existing.body.data.id)).toHaveLength(1)
      expect(rows).toHaveLength(1)
    })

    it('a bad row fails on its own without aborting the rest of the batch', async () => {
      const result = await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/commit'), raOfficer)
        .send({
          manufacturers: [
            { manufacturerKey: 'MFG-001', name: 'Good Co' },
            { manufacturerKey: '', name: 'Missing Key Co' },
          ],
        })
        .expect(201)

      expect(result.body.data.manufacturers.committed).toBe(1)
      expect(result.body.data.manufacturers.failed).toHaveLength(1)
      expect(result.body.data.manufacturers.failed[0].error).toMatch(/Manufacturer Key is required/)
    })

    it('writes a real audit entry for the whole batch', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/commit'), raOfficer)
        .send({ manufacturers: [{ manufacturerKey: 'MFG-001', name: 'Acme Pharmaceuticals' }] })
        .expect(201)

      const audit = await testPrisma.auditEntry.findFirst({
        where: { companyId, action: 'reg_entities_bulk_import_completed' },
      })
      expect(audit).toBeTruthy()
      expect(audit!.newValue).toMatchObject({ manufacturers: { attempted: 1, committed: 1, failed: 0 } })
    })

    it('403s for an actor without regulatory.manage_entities', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-entities-import/commit'), underPermissioned)
        .send({ manufacturers: [{ manufacturerKey: 'MFG-001', name: 'Acme' }] })
        .expect(403)
    })
  })
})
