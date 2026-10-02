import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud (Phase 13) Stage 19 (Environmental Monitoring & Stability
 * Programme) and Stage 20 (Cross-Module Integration & QualCloud
 * Dashboards), exercised end-to-end against the real running app and
 * real Postgres — the last two stages in `todo-qualcloud.md`.
 */
describe('QualCloud Stages 19-20 — Environmental Monitoring/Stability, Dashboards (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let associate: TestActor
  let admin: TestActor
  let facilityId: string
  let productId: string
  let specificationId: string
  let parameterId: string

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

  async function seedRole(key: string, permissionKeys: string[]): Promise<void> {
    const roleId = randomUUID()
    await testPrisma.role.create({
      data: { id: roleId, key, name: key, description: 'test fixture', isPlatform: false },
    })
    for (const permKey of permissionKeys) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'test fixture' },
        update: {},
      })
      await testPrisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Stage19-20 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_ASSOCIATE', [
      'quality.view_all',
      'quality.manage_environmental_monitoring',
      'quality.manage_stability',
      'quality.view_metrics',
      'quality.view_pqr',
      'company_profile.manage',
      'reports.view',
      'master_data.manage',
      'master_data.view',
      'quality.manage_documents',
    ])

    const platformRoleId = randomUUID()
    await testPrisma.role.create({
      data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true },
    })
    for (const permKey of ['platform.config.manage']) {
      const permission = await testPrisma.permission.upsert({
        where: { key: permKey },
        create: { id: randomUUID(), key: permKey, description: 'test fixture' },
        update: {},
      })
      await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: permission.id } })
    }

    associate = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

    const facilityRes = await authedWrite(request(httpServer(app)).post('/api/v1/facilities'), associate)
      .send({ name: 'Nairobi Manufacturing Site', countryId })
      .expect(201)
    facilityId = facilityRes.body.data.id as string

    const productRes = await authedWrite(request(httpServer(app)).post('/api/v1/products'), associate)
      .send({ brandName: 'Amoxil', genericName: 'Amoxicillin', productCategory: 'medicinal', dosageForm: 'Tablet', strength: '500mg' })
      .expect(201)
    productId = productRes.body.data.id as string

    const specRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/specifications'), associate)
      .send({
        specificationNumber: 'SPEC-STAB-001',
        title: 'Amoxicillin 500mg Tablets',
        specificationType: 'finished_product',
        productId,
        parameters: [{ parameterName: 'Assay', lowerLimit: '95', upperLimit: '105', unit: '%' }],
      })
      .expect(201)
    specificationId = specRes.body.data.id as string
    parameterId = specRes.body.data.parameters[0].id as string
  })

  describe('Stage 19 — Environmental Monitoring', () => {
    it('defaults to the EU GMP Annex 1 grade A viable-air limits and records no excursion for a clean reading', async () => {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), associate)
        .send({
          facilityId,
          cleanroomGrade: 'A',
          monitoringType: 'viable_air',
          result: '0',
          sampledAt: new Date().toISOString(),
        })
        .expect(201)
      expect(res.body.data.actionLimit).toBe('1')
      expect(res.body.data.excursion).toBe(false)
    })

    it('flags an action-limit excursion and opens a real Task against the record — never a Deviation', async () => {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), associate)
        .send({
          facilityId,
          cleanroomGrade: 'A',
          monitoringType: 'viable_air',
          result: '5',
          sampledAt: new Date().toISOString(),
        })
        .expect(201)
      expect(res.body.data.excursion).toBe(true)
      expect(res.body.data.excursionLevel).toBe('action')

      // `task`/`deviation` both carry `FORCE ROW LEVEL SECURITY` — a raw
      // read through the plain, out-of-band `testPrisma` client needs the
      // same `app.bypass_rls` session variable production's
      // `runWithSystemAccess` sets, matching the identical pattern
      // already established in `tasks.e2e-spec.ts`/`pv-case.e2e-spec.ts`.
      const [tasks, deviations] = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return Promise.all([
          tx.task.findMany({
            where: { companyId, recordType: 'environmental_monitoring_result', recordId: res.body.data.id },
          }),
          tx.deviation.findMany({ where: { companyId } }),
        ])
      })
      expect(tasks).toHaveLength(1)
      expect(tasks[0].title).toContain('Action-limit excursion')
      expect(deviations).toHaveLength(0)
    })

    it('rejects an actor without quality.manage_environmental_monitoring', async () => {
      await seedRole('EXECUTIVE_READONLY', ['quality.view_all'])
      const readonly = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), readonly)
        .send({ facilityId, cleanroomGrade: 'A', monitoringType: 'viable_air', result: '0', sampledAt: new Date().toISOString() })
        .expect(403)
    })

    it('lists results filtered to excursions only', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), associate)
        .send({ facilityId, cleanroomGrade: 'A', monitoringType: 'viable_air', result: '0', sampledAt: new Date().toISOString() })
        .expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), associate)
        .send({ facilityId, cleanroomGrade: 'A', monitoringType: 'viable_air', result: '5', sampledAt: new Date().toISOString() })
        .expect(201)

      const res = await authed(
        request(httpServer(app)).get('/api/v1/quality/environmental-monitoring?excursionOnly=true'),
        associate,
      ).expect(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].excursion).toBe(true)
    })
  })

  describe('Stage 19 — Stability Programme', () => {
    it('seeds the full ICH Q1A(R2) timepoint schedule and records a within-spec result', async () => {
      const studyRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/stability-studies'), associate)
        .send({ productId, specificationId, storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01' })
        .expect(201)
      const studyId = studyRes.body.data.id as string

      const studyDetail = await authed(request(httpServer(app)).get(`/api/v1/quality/stability-studies/${studyId}`), associate).expect(200)
      expect(studyDetail.body.data.timepoints).toHaveLength(8)
      const timepoints = studyDetail.body.data.timepoints as { id: string; timepointMonths: number }[]
      const zeroMonth = timepoints.find((t) => t.timepointMonths === 0)!

      const resultRes = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/stability-studies/timepoints/${zeroMonth.id}/results`),
        associate,
      )
        .send({ pullDate: '2026-01-02', results: [{ parameterId, result: '100' }] })
        .expect(201)
      expect(resultRes.body.data.status).toBe('results_recorded')
      expect(resultRes.body.data.withinSpec).toBe(true)
    })

    it('flags an out-of-spec timepoint result', async () => {
      const studyRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/stability-studies'), associate)
        .send({ productId, specificationId, storageCondition: 'accelerated_40c_75rh', startDate: '2026-01-01', timepointMonths: [0, 3] })
        .expect(201)
      const studyId = studyRes.body.data.id as string
      const studyDetail = await authed(request(httpServer(app)).get(`/api/v1/quality/stability-studies/${studyId}`), associate).expect(200)
      const timepoints = studyDetail.body.data.timepoints as { id: string; timepointMonths: number }[]
      const threeMonth = timepoints.find((t) => t.timepointMonths === 3)!

      const resultRes = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/stability-studies/timepoints/${threeMonth.id}/results`),
        associate,
      )
        .send({ pullDate: '2026-04-01', results: [{ parameterId, result: '80' }] })
        .expect(201)
      expect(resultRes.body.data.withinSpec).toBe(false)
    })

    it('feeds a real stability result into PqrService.assemble()\'s own stabilityNote — the real integration this stage required', async () => {
      const studyRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/stability-studies'), associate)
        .send({ productId, specificationId, storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01', timepointMonths: [0] })
        .expect(201)
      const studyId = studyRes.body.data.id as string
      const studyDetail = await authed(request(httpServer(app)).get(`/api/v1/quality/stability-studies/${studyId}`), associate).expect(200)
      const zeroMonth = studyDetail.body.data.timepoints[0]
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/stability-studies/timepoints/${zeroMonth.id}/results`), associate)
        .send({ pullDate: '2026-01-02', results: [{ parameterId, result: '100' }] })
        .expect(201)

      const pqrRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/pqr/assemble'), associate)
        .send({ productId, periodStart: '2026-01-01', periodEnd: '2026-12-31' })
        .expect(201)
      expect(pqrRes.body.data.assembledData.stabilityNote).toContain('within specification')
      expect(pqrRes.body.data.assembledData.stabilityNote).not.toContain('Not yet applicable')
    })
  })

  describe('Stage 20 — Dashboard integration', () => {
    it('reports qualcloud.available: false until the module is actually entitled', async () => {
      const res = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), associate).expect(200)
      expect(res.body.data.qualcloud.available).toBe(false)
    })

    it('reports real, live QualCloud data once the qualcloud module is entitled', async () => {
      await authedWrite(request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`), admin)
        .send({ moduleKey: 'qualcloud', enabled: true })
        .expect(201)

      await authedWrite(request(httpServer(app)).post('/api/v1/quality/environmental-monitoring'), associate)
        .send({ facilityId, cleanroomGrade: 'A', monitoringType: 'viable_air', result: '5', sampledAt: new Date().toISOString() })
        .expect(201)

      const res = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), associate).expect(200)
      expect(res.body.data.qualcloud.available).toBe(true)
      expect(typeof res.body.data.qualcloud.capasOverdue).toBe('number')
      expect(typeof res.body.data.qualcloud.documentsPendingApproval).toBe('number')
      expect(res.body.data.qualcloud.metrics).not.toBeNull()
    })
  })
})
