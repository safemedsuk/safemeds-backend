import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

describe('Country config version-on-write API (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let countryId: string
  let authorityId: string
  let reportTypeId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  // `setup-e2e.ts`'s global `afterEach` truncates every table, so fixtures
  // (country/authority/report-type) and the authenticated actor are
  // recreated before each test rather than once in `beforeAll`.
  beforeEach(async () => {
    countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })

    authorityId = newId()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })

    reportTypeId = newId()
    await testPrisma.reportType.create({
      data: { id: reportTypeId, typeKey: 'adr', name: 'Adverse Drug Reaction' },
    })

    // The RBAC catalog (`prisma/rbac.seed-data.ts`) is only ever loaded by
    // `pnpm prisma:seed` against a real dev DB — `test/global-setup.ts` only
    // runs migrations, and every table is truncated between tests anyway —
    // so the minimal slice this spec depends on (`super_admin` →
    // `platform.config.manage`) is seeded directly here each time.
    const roleId = newId()
    await testPrisma.role.create({
      data: {
        id: roleId,
        key: 'super_admin',
        name: 'Platform Super Admin',
        description: 'test fixture',
        isPlatform: true,
      },
    })
    const permissionId = newId()
    await testPrisma.permission.create({
      data: { id: permissionId, key: 'platform.config.manage', description: 'test fixture' },
    })
    await testPrisma.rolePermission.create({ data: { roleId, permissionId } })

    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })
  })

  function authed(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader)
  }

  describe('reporting rules', () => {
    it('starts empty, then create → activate walks version 1 through to active', async () => {
      const empty = await authed(
        request(httpServer(app)).get('/api/v1/country-config/reporting-rules'),
        admin,
      ).expect(200)
      expect(empty.body).toEqual({
        data: [],
        meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
      })

      const createRes = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 15,
          effectiveFrom: '2026-01-01',
        })
        .expect(201)

      expect(createRes.body.data).toMatchObject({ version: 1, status: 'draft', windowDays: 15 })
      const ruleId = createRes.body.data.id as string

      const activateRes = await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${ruleId}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(201)
      expect(activateRes.body.data).toMatchObject({ id: ruleId, status: 'active' })

      const listRes = await authed(
        request(httpServer(app)).get('/api/v1/country-config/reporting-rules'),
        admin,
      ).expect(200)
      expect(listRes.body.data).toHaveLength(1)
      expect(listRes.body.data[0]).toMatchObject({ id: ruleId, status: 'active', version: 1 })
    })

    it('creating a second version and activating it retires the first, both visible in the list', async () => {
      const v1 = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 15,
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
      await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${v1.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(201)

      const v2 = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 7,
          effectiveFrom: '2026-02-01',
        })
        .expect(201)
      expect(v2.body.data.version).toBe(2)

      await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${v2.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(201)

      const listRes = await authed(
        request(httpServer(app)).get('/api/v1/country-config/reporting-rules'),
        admin,
      ).expect(200)
      const rows = listRes.body.data as { id: string; status: string }[]
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]))
      expect(byId[v1.body.data.id]).toBe('retired')
      expect(byId[v2.body.data.id]).toBe('active')
    })

    it('refuses to activate a rule still marked unverified (Q1 — Kenya 7d/15d conflict)', async () => {
      const created = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 7,
          unverified: true,
          effectiveFrom: '2026-01-01',
        })
        .expect(201)

      const res = await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${created.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(400)
      expect(res.body.error.code).toBe('RULE_UNVERIFIED')
    })

    it('404s activating a non-existent rule id', async () => {
      const res = await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${newId()}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('409s re-activating an already-active rule (not a draft anymore)', async () => {
      const created = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 15,
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
      await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${created.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(201)

      const res = await request(httpServer(app))
        .post(`/api/v1/country-config/reporting-rules/${created.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(409)
      expect(res.body.error.code).toBe('NOT_DRAFT')
    })

    it('accepts an optional reportingPeriodDays for a periodic (PSUR/PBRER-style) cadence, separate from windowDays (Stage 0.11)', async () => {
      const res = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'periodic',
          windowDays: 1,
          reportingPeriodDays: 180,
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
      expect(res.body.data).toMatchObject({ reportingPeriodDays: 180, windowDays: 1 })
    })

    it('401s an unauthenticated create attempt', async () => {
      await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 15,
          effectiveFrom: '2026-01-01',
        })
        .expect(401)
    })

    it('403s a create attempt from an authenticated actor lacking platform.config.manage', async () => {
      const nobody = await createAuthenticatedActor(app, testPrisma, {
        companyId: null,
        roleKeys: [],
      })
      const res = await request(httpServer(app))
        .post('/api/v1/country-config/reporting-rules')
        .set('Cookie', nobody.cookieHeader)
        .set('X-CSRF-Token', nobody.csrfHeader)
        .send({
          authorityId,
          reportTypeId,
          seriousnessClass: 'serious',
          windowDays: 15,
          effectiveFrom: '2026-01-01',
        })
        .expect(403)
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS')
    })
  })

  describe('seriousness definitions (second config type, proving the pattern generalizes)', () => {
    it('walks create → activate the same way as reporting rules', async () => {
      const created = await request(httpServer(app))
        .post('/api/v1/country-config/seriousness-definitions')
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .send({
          authorityId,
          criterionKey: 'hospitalisation',
          label: 'Hospitalisation or prolongation',
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
      expect(created.body.data).toMatchObject({ version: 1, status: 'draft' })

      await request(httpServer(app))
        .post(`/api/v1/country-config/seriousness-definitions/${created.body.data.id}/activate`)
        .set('Cookie', admin.cookieHeader)
        .set('X-CSRF-Token', admin.csrfHeader)
        .expect(201)

      const listRes = await authed(
        request(httpServer(app)).get(
          `/api/v1/country-config/seriousness-definitions?authorityId=${authorityId}`,
        ),
        admin,
      ).expect(200)
      expect(listRes.body.data[0]).toMatchObject({ id: created.body.data.id, status: 'active' })
    })
  })

  // real-usage report, 19 Aug 2026 — GET /countries/:id/config used to
  // silently omit a report type from an authority's node entirely whenever
  // it had zero active reporting rules/submission formats, on the theory
  // that "has an active rule naming this authority" was the real signal for
  // whether the type belongs to it. That made the very first configuration
  // of any report type impossible through the real admin UI — a brand-new
  // authority (or `line_listing`, which has no natural authority binding at
  // all) never had an active rule yet, so its row was never visible to
  // click into and create one. See country-config.service.ts's own comment
  // at the fix site for the full account.
  describe('GET /countries/:id/config', () => {
    interface ConfigReportTypeNode {
      id: string
      activeReportingRules: unknown[]
    }
    interface ConfigAuthorityNode {
      id: string
      reportTypes: ConfigReportTypeNode[]
    }

    it('lists a report type with zero active rules — not just ones already configured', async () => {
      const lineListingId = newId()
      await testPrisma.reportType.create({
        data: { id: lineListingId, typeKey: 'line_listing', name: 'Periodic Line Listing' },
      })

      const res = await authed(
        request(httpServer(app)).get(`/api/v1/countries/${countryId}/config`),
        admin,
      ).expect(200)
      const data = res.body.data as ConfigAuthorityNode[]

      const authority = data.find((a) => a.id === authorityId)
      expect(authority).toBeDefined()
      const lineListingNode = authority!.reportTypes.find((rt) => rt.id === lineListingId)
      expect(lineListingNode).toBeDefined()
      expect(lineListingNode!.activeReportingRules).toEqual([])

      // The already-seeded `adr` type (also zero active rules yet) must
      // show too — this isn't `line_listing`-specific.
      const adrNode = authority!.reportTypes.find((rt) => rt.id === reportTypeId)
      expect(adrNode).toBeDefined()
    })

    it('a freshly-created authority with no configuration at all still lists every report type', async () => {
      const freshAuthorityId = newId()
      await testPrisma.regulatoryAuthority.create({
        data: { id: freshAuthorityId, countryId, code: 'FRESH', name: 'Fresh Authority' },
      })

      const res = await authed(
        request(httpServer(app)).get(`/api/v1/countries/${countryId}/config`),
        admin,
      ).expect(200)
      const data = res.body.data as ConfigAuthorityNode[]

      const freshNode = data.find((a) => a.id === freshAuthorityId)
      expect(freshNode).toBeDefined()
      expect(freshNode!.reportTypes.length).toBeGreaterThan(0)
    })
  })
})
