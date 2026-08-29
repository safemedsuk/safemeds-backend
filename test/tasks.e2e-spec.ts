import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * Special Corner SC-6 — the Task Inbox UX overhaul's real, buildable
 * "how can a task be reassigned to someone else" answer: `POST /tasks/:id/release`
 * puts a claimed task back into the open role queue for a teammate to
 * claim, and `GET /tasks?recordId=` powers a "tasks for this record"
 * view — both new this pass, no prior e2e coverage existed for the
 * tasks module at all (only `claim` had any HTTP-level exercise, via
 * other stages' own specs incidentally).
 */
describe('Tasks — release + recordId filter (e2e)', () => {
  let app: INestApplication

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

  async function createTestCompanyId(): Promise<string> {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    const companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })
    return companyId
  }

  /**
   * `task` carries `FORCE ROW LEVEL SECURITY` — a raw insert through the
   * plain, out-of-band `testPrisma` client needs the same `app.bypass_rls`
   * session variable production's `runWithSystemAccess` sets, matching
   * the identical pattern already established in `pv-case.e2e-spec.ts`.
   */
  async function createOpenTask(companyId: string, recordId: string, assignedRoleKey: string) {
    const id = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.task.create({
        data: { id, companyId, recordType: 'pv_case', recordId, title: 'Triage this case', assignedRoleKey, status: 'open', urgency: 'normal' },
      })
    })
    return id
  }

  it('claims, then releases a task back to open — the claimer can claim it again afterward', async () => {
    const companyId = await createTestCompanyId()
    const actor = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId })
    const recordId = randomUUID()
    const taskId = await createOpenTask(companyId, recordId, 'SUPERINTENDENT_PHARMACIST')

    const claimed = await authedWrite(request(httpServer(app)).post(`/api/v1/tasks/${taskId}/claim`), actor).expect(201)
    expect(claimed.body.data.status).toBe('claimed')
    expect(claimed.body.data.claimedBy).toBe(actor.userId)

    const released = await authedWrite(request(httpServer(app)).post(`/api/v1/tasks/${taskId}/release`), actor).expect(201)
    expect(released.body.data.status).toBe('open')
    expect(released.body.data.claimedBy).toBeNull()

    // Now open again — the same actor (or a teammate) can re-claim it.
    const reclaimed = await authedWrite(request(httpServer(app)).post(`/api/v1/tasks/${taskId}/claim`), actor).expect(201)
    expect(reclaimed.body.data.status).toBe('claimed')
  })

  it('rejects releasing a task that is not currently claimed by the caller with NOT_YOUR_CLAIM', async () => {
    const companyId = await createTestCompanyId()
    const claimer = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId })
    const bystander = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId })
    const recordId = randomUUID()
    const taskId = await createOpenTask(companyId, recordId, 'SUPERINTENDENT_PHARMACIST')

    await authedWrite(request(httpServer(app)).post(`/api/v1/tasks/${taskId}/claim`), claimer).expect(201)

    const rejected = await authedWrite(request(httpServer(app)).post(`/api/v1/tasks/${taskId}/release`), bystander).expect(403)
    expect(rejected.body.error.code).toBe('NOT_YOUR_CLAIM')
  })

  it('GET /tasks?recordId= returns only tasks tied to that specific record, across scopes', async () => {
    const companyId = await createTestCompanyId()
    const actor = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['SUPERINTENDENT_PHARMACIST'], companyId })
    const recordIdA = randomUUID()
    const recordIdB = randomUUID()
    await createOpenTask(companyId, recordIdA, 'SUPERINTENDENT_PHARMACIST')
    await createOpenTask(companyId, recordIdA, 'QPPV')
    await createOpenTask(companyId, recordIdB, 'SUPERINTENDENT_PHARMACIST')

    const res = await authed(request(httpServer(app)).get(`/api/v1/tasks?scope=all&recordId=${recordIdA}`), actor).expect(200)
    const rows = res.body.data as { recordId: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((t) => t.recordId === recordIdA)).toBe(true)
  })
})
