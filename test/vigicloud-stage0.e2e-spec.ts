import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { EntitlementsService } from '../src/modules/entitlements/entitlements.service'
import { RecordVersioningService } from '../src/modules/record-versioning/record-versioning.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

/** Creates a Role + the given Permission keys + RolePermission rows, matching the master-data.e2e-spec.ts fixture pattern (the real rbac seed never runs against the truncated-per-test e2e database). */
async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
  const roleId = randomUUID()
  await testPrisma.role.create({ data: { id: roleId, key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false } })

  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({
      where: { key },
      update: {},
      create: { id: randomUUID(), key, description: 'e2e fixture' },
    })
    await testPrisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
  }
}

describe('VigiCloud Stage 0 — Consent (e2e)', () => {
  let app: INestApplication
  let actor: TestActor
  let companyId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Consent Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    await seedRoleWithPermissions('QPPV', ['consent.manage'])
    actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QPPV'] })
  })

  it('captures consent, checks it, lists it, then withdraws it', async () => {
    const captured = await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), actor)
      .send({ recordType: 'pv_case', recordId: 'case-1', consentType: 'contact', granted: true, method: 'written' })
      .expect(201)
    expect(captured.body.data.granted).toBe(true)
    expect(captured.body.data.grantedAt).not.toBeNull()

    const check = await authed(
      request(httpServer(app)).get('/api/v1/consent-records/check?recordType=pv_case&recordId=case-1&consentType=contact'),
      actor,
    ).expect(200)
    expect(check.body.data).toEqual({ hasRecord: true, granted: true, record: expect.objectContaining({ id: captured.body.data.id }) })

    const list = await authed(request(httpServer(app)).get('/api/v1/consent-records?recordType=pv_case&recordId=case-1'), actor).expect(200)
    expect(list.body.data).toHaveLength(1)

    const withdrawn = await authedWrite(request(httpServer(app)).post(`/api/v1/consent-records/${captured.body.data.id}/withdraw`), actor).expect(201)
    expect(withdrawn.body.data.withdrawnAt).not.toBeNull()

    const recheck = await authed(
      request(httpServer(app)).get('/api/v1/consent-records/check?recordType=pv_case&recordId=case-1&consentType=contact'),
      actor,
    ).expect(200)
    expect(recheck.body.data.granted).toBe(false)

    // withdrawing again is rejected — already withdrawn
    await authedWrite(request(httpServer(app)).post(`/api/v1/consent-records/${captured.body.data.id}/withdraw`), actor).expect(409)
  })

  it('records a declined consent (granted: false) distinctly from "no record at all"', async () => {
    const neverAsked = await authed(
      request(httpServer(app)).get('/api/v1/consent-records/check?recordType=pv_case&recordId=case-never-asked&consentType=contact'),
      actor,
    ).expect(200)
    expect(neverAsked.body.data).toEqual({ hasRecord: false, granted: null, record: null })

    await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), actor)
      .send({ recordType: 'pv_case', recordId: 'case-declined', consentType: 'contact', granted: false, method: 'verbal' })
      .expect(201)

    const declined = await authed(
      request(httpServer(app)).get('/api/v1/consent-records/check?recordType=pv_case&recordId=case-declined&consentType=contact'),
      actor,
    ).expect(200)
    expect(declined.body.data).toEqual({ hasRecord: true, granted: false, record: expect.anything() })
  })

  it('401s unauthenticated, 403s an actor without consent.manage', async () => {
    await request(httpServer(app)).post('/api/v1/consent-records').send({}).expect(401)

    await seedRoleWithPermissions('READ_ONLY_ROLE', [])
    const noPermActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['READ_ONLY_ROLE'] })
    await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), noPermActor)
      .send({ recordType: 'pv_case', recordId: 'case-1', consentType: 'contact', granted: true, method: 'written' })
      .expect(403)
  })

  it("never returns another company's consent records (RLS isolation)", async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/consent-records'), actor)
      .send({ recordType: 'pv_case', recordId: 'shared-record-id', consentType: 'contact', granted: true, method: 'written' })
      .expect(201)

    const otherCountryId = randomUUID()
    await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
    const otherCompanyId = randomUUID()
    await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Co', companyType: 'manufacturer', homeCountryId: otherCountryId, status: 'active' } })
    const otherActor = await createAuthenticatedActor(app, testPrisma, { companyId: otherCompanyId, roleKeys: ['QPPV'] })

    const otherCheck = await authed(
      request(httpServer(app)).get('/api/v1/consent-records/check?recordType=pv_case&recordId=shared-record-id&consentType=contact'),
      otherActor,
    ).expect(200)
    expect(otherCheck.body.data).toEqual({ hasRecord: false, granted: null, record: null })
  })
})

describe('VigiCloud Stage 0 — Data-subject requests (e2e)', () => {
  let app: INestApplication
  let actor: TestActor
  let companyId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'DSR Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['data_privacy.manage'])
    actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
  })

  it('an export request completes immediately', async () => {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/data-subject-requests'), actor)
      .send({ recordType: 'pv_case', recordId: 'case-1', requestType: 'export' })
      .expect(201)

    expect(res.body.data.status).toBe('completed')
    expect(res.body.data.completedAt).not.toBeNull()
  })

  it('an erasure request is blocked when a real open Deadline exists for that record, and completes once none does', async () => {
    // Real Deadline fixture, not a stand-in — Deadline needs a real ReportingRule FK,
    // and Deadline.recordId is itself a `@db.Uuid` column (it always points at a real
    // internal record id in production), so the fixture recordId must be a real UUID.
    const recordIdWithDeadline = randomUUID()
    const recordIdWithNoDeadline = randomUUID()

    const authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId: (await testPrisma.company.findUniqueOrThrow({ where: { id: companyId } })).homeCountryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })
    const reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: 'adr_e2e_dsr', name: 'ADR' } })
    const reportingRuleId = randomUUID()
    await testPrisma.reportingRule.create({
      data: { id: reportingRuleId, authorityId, reportTypeId, seriousnessClass: 'serious', windowDays: 15, status: 'active', effectiveFrom: new Date('2026-01-01') },
    })
    // `deadline` has FORCE ROW LEVEL SECURITY (phase5_1) — a raw insert
    // through the plain, out-of-band `testPrisma` client (not one of
    // `RlsService`'s RLS-bound transactions) needs the same bypass session
    // variable `createAuthenticatedActor` already uses for `app_user`.
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.deadline.create({
        data: { id: randomUUID(), companyId, recordType: 'pv_case', recordId: recordIdWithDeadline, reportingRuleId, dueAt: new Date('2027-01-01'), status: 'pending' },
      })
    })

    const blocked = await authedWrite(request(httpServer(app)).post('/api/v1/data-subject-requests'), actor)
      .send({ recordType: 'pv_case', recordId: recordIdWithDeadline, requestType: 'erasure' })
      .expect(201)
    expect(blocked.body.data.status).toBe('blocked')
    expect(blocked.body.data.blockedReason).toContain('open regulatory deadline')

    const notBlocked = await authedWrite(request(httpServer(app)).post('/api/v1/data-subject-requests'), actor)
      .send({ recordType: 'pv_case', recordId: recordIdWithNoDeadline, requestType: 'erasure' })
      .expect(201)
    expect(notBlocked.body.data.status).toBe('completed')

    const list = await authed(request(httpServer(app)).get('/api/v1/data-subject-requests?status=blocked'), actor).expect(200)
    expect(list.body.data).toHaveLength(1)
    expect(list.body.data[0].recordId).toBe(recordIdWithDeadline)
  })
})

describe('VigiCloud Stage 0 — Record versioning (e2e)', () => {
  let app: INestApplication
  let actor: TestActor
  let companyId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Versioning Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    await seedRoleWithPermissions('EXECUTIVE_READONLY', ['records.view_all'])
    actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
  })

  it('a version captured internally via the service is visible through the real GET history endpoint, newest first', async () => {
    // No live domain writes to this yet (see RecordVersioningService's doc
    // comment) — this simulates what a future Stage 1 CaseService will do:
    // call `createVersion()` directly, server-side, not via a public POST.
    const recordVersioningService = app.get(RecordVersioningService)
    await recordVersioningService.createVersion(
      { sub: actor.userId, companyId },
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { status: 'intake' } },
      {},
    )
    await recordVersioningService.createVersion(
      { sub: actor.userId, companyId },
      { recordType: 'pv_case', recordId: 'case-1', snapshot: { status: 'triage' }, reason: 'triaged' },
      {},
    )

    const res = await authed(request(httpServer(app)).get('/api/v1/records/pv_case/case-1/versions'), actor).expect(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].versionNumber).toBe(2)
    expect(res.body.data[0].reason).toBe('triaged')
    expect(res.body.data[1].versionNumber).toBe(1)
  })
})

describe('VigiCloud Stage 0 — Entitlements (e2e)', () => {
  let app: INestApplication
  let tenantActor: TestActor
  let superAdmin: TestActor
  let operationsStaff: TestActor
  let companyId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Entitlement Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    tenantActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [] })
    superAdmin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })
    operationsStaff = await createAuthenticatedActor(app, testPrisma, { platformRole: 'operations' })

    // VigiCloud Stage 16.1 — switching the `vigicloud` entitlement on now
    // requires an active PSMF for the company (a real precondition this
    // Stage 0 spec predates); seeded directly here since this describe
    // block is about the entitlement grant itself, not PSMF onboarding.
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.psmf.create({ data: { id: randomUUID(), companyId, version: 1, status: 'active', title: 'Fixture PSMF' } })
    })
  })

  it('a company starts with no entitlements, GET /platform/companies finds it, super_admin grants vigicloud, and it is now enabled', async () => {
    const mineBefore = await authed(request(httpServer(app)).get('/api/v1/entitlements/mine'), tenantActor).expect(200)
    expect(mineBefore.body.data).toEqual([])

    const companies = await authed(request(httpServer(app)).get('/api/v1/platform/companies?q=Entitlement'), superAdmin).expect(200)
    const companyRows = companies.body.data as { id: string }[]
    expect(companyRows.map((c) => c.id)).toContain(companyId)

    const granted = await authedWrite(request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`), superAdmin)
      .send({ moduleKey: 'vigicloud', enabled: true })
      .expect(201)
    expect(granted.body.data.enabled).toBe(true)
    expect(granted.body.data.featureKey).toBe('*')

    const mineAfter = await authed(request(httpServer(app)).get('/api/v1/entitlements/mine'), tenantActor).expect(200)
    expect(mineAfter.body.data).toHaveLength(1)
    expect(mineAfter.body.data[0].moduleKey).toBe('vigicloud')

    const forCompany = await authed(request(httpServer(app)).get(`/api/v1/platform/companies/${companyId}/entitlements`), superAdmin).expect(200)
    expect(forCompany.body.data).toHaveLength(1)
  })

  it('a feature-level grant overrides the module-level grant for that exact feature, verified against EntitlementsService.isEnabled() directly', async () => {
    await authedWrite(request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`), superAdmin)
      .send({ moduleKey: 'vigicloud', enabled: true })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`), superAdmin)
      .send({ moduleKey: 'vigicloud', featureKey: 'signal_management', enabled: false })
      .expect(201)

    const entitlementsService = app.get(EntitlementsService)

    await expect(entitlementsService.isEnabled(companyId, 'vigicloud')).resolves.toBe(true)
    await expect(entitlementsService.isEnabled(companyId, 'vigicloud', 'signal_management')).resolves.toBe(false)
  })

  it('is super_admin-only — operations gets 403 granting an entitlement, though it can still review registrations elsewhere', async () => {
    await authedWrite(request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`), operationsStaff)
      .send({ moduleKey: 'vigicloud', enabled: true })
      .expect(403)
  })

  it('a plain tenant user 401s/403s the platform-only company list', async () => {
    await request(httpServer(app)).get('/api/v1/platform/companies').expect(401)
    await authed(request(httpServer(app)).get('/api/v1/platform/companies'), tenantActor).expect(403)
  })
})

describe('VigiCloud Stage 0 — Bulk import (e2e)', () => {
  let app: INestApplication
  let actor: TestActor
  let companyId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Bulk Import Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['users.invite'])
    actor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
  })

  it('preview() splits a CSV into valid/invalid rows without writing anything', async () => {
    const csvText = 'email,roleKeys\ngood@example.com,QPPV\nnot-an-email,QPPV\nanother@example.com,NOT_A_REAL_ROLE'

    const res = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/user_invite/preview'), actor).send({ csvText }).expect(201)

    expect(res.body.data.totalRows).toBe(3)
    expect(res.body.data.validRows).toHaveLength(1)
    expect(res.body.data.validRows[0].data.email).toBe('good@example.com')
    expect(res.body.data.invalidRows).toHaveLength(2)

    const invitations = await testPrisma.invitation.findMany({ where: { companyId } })
    expect(invitations).toHaveLength(0)
  })

  it('commit() creates real Invitation rows for valid rows and reports a per-row failure for a duplicate email, without aborting the batch', async () => {
    // Pre-existing user so one row's InvitationsService.create() genuinely fails.
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.user.create({
        data: { id: randomUUID(), companyId, email: 'already-registered@example.com', fullName: 'Existing User', passwordHash: 'x', status: 'active', roleKeys: [] },
      })
    })

    const rows = [
      { email: 'newuser1@example.com', roleKeys: 'QPPV' },
      { email: 'already-registered@example.com', roleKeys: 'QPPV' },
      { email: 'newuser2@example.com', roleKeys: 'SUPERINTENDENT_PHARMACIST' },
    ]

    const res = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/user_invite/commit'), actor).send({ rows }).expect(201)

    expect(res.body.data.committed).toBe(2)
    expect(res.body.data.failed).toHaveLength(1)
    expect(res.body.data.failed[0]).toMatchObject({ rowNumber: 2, success: false })

    // `invitation` has FORCE ROW LEVEL SECURITY (phase2_3) — same bypass
    // needed for a raw read via the plain, out-of-band `testPrisma` client.
    const invitations = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return tx.invitation.findMany({ where: { companyId } })
    })
    expect(invitations.map((i) => i.email).sort()).toEqual(['newuser1@example.com', 'newuser2@example.com'])

    const auditEntries = await testPrisma.auditEntry.findMany({ where: { companyId, action: 'bulk_import_completed' } })
    expect(auditEntries).toHaveLength(1)
  })

  it('404s an unknown import type', async () => {
    await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/not_a_real_type/preview'), actor).send({ csvText: 'a,b\n1,2' }).expect(404)
  })

  it('accepts human-friendly role labels and real spreadsheet header spellings, end to end — not just the raw enum keys', async () => {
    // Neither header is the technical "email"/"roleKeys" name, and the
    // role is the same label shown in the "Add User" modal, not the raw key.
    const csvText = 'Email Address,Role(s)\nfriendly-label@example.com,Superintendent Pharmacist'

    const previewRes = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/user_invite/preview'), actor)
      .send({ csvText })
      .expect(201)
    expect(previewRes.body.data.validRows).toHaveLength(1)
    expect(previewRes.body.data.validRows[0].data.email).toBe('friendly-label@example.com')

    const validRows = previewRes.body.data.validRows as { data: Record<string, string> }[]
    const commitRes = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/user_invite/commit'), actor)
      .send({ rows: validRows.map((r) => r.data) })
      .expect(201)
    expect(commitRes.body.data.committed).toBe(1)

    const invitations = await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return tx.invitation.findMany({ where: { companyId, email: 'friendly-label@example.com' } })
    })
    expect(invitations).toHaveLength(1)
    // Stored as the canonical raw key — "Superintendent Pharmacist" was resolved server-side.
    expect(invitations[0].roleKeys).toEqual(['SUPERINTENDENT_PHARMACIST'])
  })
})
