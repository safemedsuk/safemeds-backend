import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

describe('Generated Reports primitive (e2e)', () => {
  let app: INestApplication
  let manager: TestActor
  let viewerOnly: TestActor

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const manageRoleId = newId()
    await testPrisma.role.create({ data: { id: manageRoleId, key: 'QPPV', name: 'QPPV', description: 'test fixture', isPlatform: false } })
    const viewRoleId = newId()
    await testPrisma.role.create({ data: { id: viewRoleId, key: 'EXECUTIVE_READONLY', name: 'Executive', description: 'test fixture', isPlatform: false } })

    const managePermId = newId()
    await testPrisma.permission.create({ data: { id: managePermId, key: 'reports.manage', description: 'test fixture' } })
    const viewPermId = newId()
    await testPrisma.permission.create({ data: { id: viewPermId, key: 'reports.view', description: 'test fixture' } })

    await testPrisma.rolePermission.create({ data: { roleId: manageRoleId, permissionId: managePermId } })
    await testPrisma.rolePermission.create({ data: { roleId: manageRoleId, permissionId: viewPermId } })
    await testPrisma.rolePermission.create({ data: { roleId: viewRoleId, permissionId: viewPermId } })

    const companyId = newId()
    const countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    await testPrisma.company.create({ data: { id: companyId, name: 'E2E Reports Co', companyType: 'manufacturer', homeCountryId: countryId } })

    manager = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QPPV'] })
    viewerOnly = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
  })

  it('walks a report through create (draft) → finalize (final) → submit (submitted)', async () => {
    const createRes = await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .send({ moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q1 2026 PSUR', dueAt: '2026-04-30' })
      .expect(201)
    expect(createRes.body.data).toMatchObject({ status: 'draft', moduleKey: 'pv', title: 'Q1 2026 PSUR' })
    const reportId = createRes.body.data.id as string

    const finalizeRes = await request(httpServer(app))
      .post(`/api/v1/reports/${reportId}/finalize`)
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .expect(201)
    expect(finalizeRes.body.data).toMatchObject({ status: 'final' })

    const submitRes = await request(httpServer(app))
      .post(`/api/v1/reports/${reportId}/submit`)
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .expect(201)
    expect(submitRes.body.data).toMatchObject({ status: 'submitted' })
    expect(submitRes.body.data.submittedAt).toBeTruthy()

    const getRes = await request(httpServer(app)).get(`/api/v1/reports/${reportId}`).set('Cookie', manager.cookieHeader).expect(200)
    expect(getRes.body.data).toMatchObject({ id: reportId, status: 'submitted' })
  })

  it('refuses to submit a report still in draft', async () => {
    const createRes = await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .send({ moduleKey: 'pv', reportTypeKey: 'psur', title: 'Q2 2026 PSUR' })
      .expect(201)

    const res = await request(httpServer(app))
      .post(`/api/v1/reports/${createRes.body.data.id}/submit`)
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .expect(409)
    expect(res.body.error.code).toBe('NOT_FINAL')
  })

  it('filters the list by moduleKey and status', async () => {
    await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .send({ moduleKey: 'pv', reportTypeKey: 'psur', title: 'PV report' })
      .expect(201)
    await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .send({ moduleKey: 'qualcloud', reportTypeKey: 'batch_release', title: 'Quality report' })
      .expect(201)

    const res = await request(httpServer(app))
      .get('/api/v1/reports?moduleKey=pv')
      .set('Cookie', manager.cookieHeader)
      .expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]).toMatchObject({ moduleKey: 'pv' })
    expect(res.body.meta).toMatchObject({ total: 1 })
  })

  it('allows a reports.view-only actor to list/get but not create', async () => {
    const createRes = await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', manager.cookieHeader)
      .set('X-CSRF-Token', manager.csrfHeader)
      .send({ moduleKey: 'pv', reportTypeKey: 'psur', title: 'Viewer test report' })
      .expect(201)

    await request(httpServer(app)).get('/api/v1/reports').set('Cookie', viewerOnly.cookieHeader).expect(200)
    await request(httpServer(app)).get(`/api/v1/reports/${createRes.body.data.id}`).set('Cookie', viewerOnly.cookieHeader).expect(200)

    const forbidden = await request(httpServer(app))
      .post('/api/v1/reports')
      .set('Cookie', viewerOnly.cookieHeader)
      .set('X-CSRF-Token', viewerOnly.csrfHeader)
      .send({ moduleKey: 'pv', reportTypeKey: 'psur', title: 'Should be forbidden' })
      .expect(403)
    expect(forbidden.body.error.code).toBe('INSUFFICIENT_PERMISSIONS')
  })

  it('401s an unauthenticated request', async () => {
    await request(httpServer(app)).get('/api/v1/reports').expect(401)
  })
})
