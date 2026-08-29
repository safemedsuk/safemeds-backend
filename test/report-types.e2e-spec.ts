import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

describe('Report types catalog (e2e)', () => {
  let app: INestApplication
  let actor: TestActor

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await testPrisma.reportType.create({ data: { id: newId(), typeKey: 'adr', name: 'Suspected Adverse Drug Reaction', moduleKey: 'pv' } })
    await testPrisma.reportType.create({ data: { id: newId(), typeKey: 'device_incident', name: 'Medical Device / IVD Incident', moduleKey: 'pv' } })
    await testPrisma.reportType.create({ data: { id: newId(), typeKey: 'deviation', name: 'Quality Deviation', moduleKey: 'qualcloud' } })

    actor = await createAuthenticatedActor(app, testPrisma, { roleKeys: [] })
  })

  it('lists every report type across modules when no filter is given', async () => {
    const res = await request(httpServer(app))
      .get('/api/v1/report-types')
      .set('Cookie', actor.cookieHeader)
      .expect(200)

    expect(res.body.data).toHaveLength(3)
  })

  it('filters to exactly the requested moduleKey', async () => {
    const res = await request(httpServer(app))
      .get('/api/v1/report-types?moduleKey=pv')
      .set('Cookie', actor.cookieHeader)
      .expect(200)

    expect(res.body.data).toHaveLength(2)
    expect((res.body.data as { moduleKey: string }[]).every((r) => r.moduleKey === 'pv')).toBe(true)
  })

  it('returns an empty list for a module with nothing seeded yet', async () => {
    const res = await request(httpServer(app))
      .get('/api/v1/report-types?moduleKey=regcloud')
      .set('Cookie', actor.cookieHeader)
      .expect(200)

    expect(res.body.data).toEqual([])
  })

  it('401s an unauthenticated request', async () => {
    await request(httpServer(app)).get('/api/v1/report-types').expect(401)
  })
})
