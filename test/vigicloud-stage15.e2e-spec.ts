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

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<string> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
  return role.id
}

/**
 * VigiCloud Stage 15 — Reconciliation (15.1) + Contact Testing (15.2).
 * Real HTTP coverage against a real seeded report type/company pair,
 * matching Stage 13/14's own e2e conventions.
 */
describe('VigiCloud Stage 15 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage15 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: 'adr', name: 'Suspected ADR' } })

    // `PvCaseService.create()` calls `WorkflowService.instantiate()` —
    // needs a real, global (countryId: null) `pv_case` definition with
    // an initial state to exist, exactly like every other e2e spec that
    // creates a case. No transitions needed here — this file never
    // moves a case out of Intake.
    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    await testPrisma.workflowState.create({ data: { id: randomUUID(), definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false } })
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  async function createCase(actor: TestActor, organization: string | null, receivedDate: string): Promise<string> {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), actor)
      .send({
        reportTypeId,
        countryOfOccurrenceId: countryId,
        countryOfReportId: countryId,
        channel: 'form',
        awarenessDate: receivedDate,
        receivedDate,
        reporter: { reporterType: 'consumer', organization: organization ?? undefined },
        patient: { initials: 'J.D.' },
        suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
        adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash' }],
      })
      .expect(201)
    return res.body.data.id as string
  }

  describe('Stage 15.1 — Distributor CRUD', () => {
    it('creates, lists, gets, and updates a distributor, gated by reconciliation.manage/view', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15A', ['reconciliation.manage'])
      const viewer = await actorWith('EXECUTIVE_READONLY_15A', ['reconciliation.view'])
      const noAccess = await actorWith('DISPENSING_PHARMACIST_15A', [])

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd', contactEmail: 'ops@acme.co.ke' }).expect(201)
      expect(created.body.data.name).toBe('Acme Distribution Ltd')
      expect(created.body.data.status).toBe('active')

      await authed(request(httpServer(app)).get('/api/v1/distributors'), viewer).expect(200)
      await authed(request(httpServer(app)).get('/api/v1/distributors'), noAccess).expect(403)

      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), viewer).send({ name: 'Should be forbidden' }).expect(403)

      const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/distributors/${created.body.data.id}`), manager).send({ status: 'inactive' }).expect(200)
      expect(updated.body.data.status).toBe('inactive')
    })

    it('rejects a duplicate distributor name within the same company', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15B', ['reconciliation.manage'])
      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(409)
    })
  })

  /**
   * Seeds a `Document` row directly (never through the real upload
   * endpoint) — `DistributorTrainingService.attachCertificate()` only
   * ever validates such a row exists for this exact `(recordType,
   * recordId, companyId)`, it never itself calls `DocumentsService`,
   * so this is a faithful, real fixture for that check. Deliberately
   * avoids the generic `POST /records/:type/:id/documents/upload`
   * endpoint here: that path hits the already-documented, pre-existing
   * Jest/AWS-SDK TLS-handshake gotcha (`EPROTO`) this repo's own
   * CLAUDE.md gotchas list already covers at length for Stage 12 (and
   * confirmed there as conclusively not a product bug) — reproducing
   * it again here would only be re-litigating an already-closed
   * investigation, not testing anything new about this feature.
   */
  async function seedDocumentFor(recordType: string, recordId: string, actor: TestActor, title: string): Promise<string> {
    const documentId = randomUUID()
    await withBypass((tx) =>
      tx.document.create({
        data: { id: documentId, companyId, recordType, recordId, title, createdBy: actor.userId },
      }),
    )
    return documentId
  }

  describe('Real-usage request, 22 Sep 2026 (item 6) — Distributor Training records', () => {
    it('logs training, attaches a real certificate, computes status, and reports "missing" for an untrained distributor', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15J', ['reconciliation.manage', 'reconciliation.view'])
      const viewer = await actorWith('EXECUTIVE_READONLY_15J', ['reconciliation.view'])

      const distA = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Trained Distribution Ltd' }).expect(201)
      const distB = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Untrained Distribution Ltd' }).expect(201)

      // Untrained distributor: the real "proof they're trained annually" flag reports missing.
      const missingStatus = await authed(request(httpServer(app)).get(`/api/v1/distributor-training-records/status/${distB.body.data.id}`), viewer).expect(200)
      expect(missingStatus.body.data.status).toBe('missing')

      const record = await authedWrite(request(httpServer(app)).post('/api/v1/distributor-training-records'), manager)
        .send({
          distributorId: distA.body.data.id,
          trainingType: 'pv_annual',
          title: 'Annual PV/Reporting-Obligations Training 2026',
          completionDate: '2026-01-15',
          expiryDate: '2027-01-15',
        })
        .expect(201)
      expect(record.body.data.title).toBe('Annual PV/Reporting-Obligations Training 2026')

      // A viewer can read but never log/attach.
      await authed(request(httpServer(app)).get('/api/v1/distributor-training-records'), viewer).expect(200)
      await authedWrite(request(httpServer(app)).post('/api/v1/distributor-training-records'), viewer)
        .send({ distributorId: distA.body.data.id, trainingType: 'x', title: 'y', completionDate: '2026-01-01' })
        .expect(403)

      const recordId = record.body.data.id as string
      const documentId = await seedDocumentFor('distributor_training_record', recordId, manager, 'Training completion certificate')
      const withCertificate = await authedWrite(request(httpServer(app)).post(`/api/v1/distributor-training-records/${recordId}/certificate`), manager)
        .send({ documentId })
        .expect(201)
      expect(withCertificate.body.data.certificateDocumentId).toBe(documentId)

      const list = await authed(request(httpServer(app)).get(`/api/v1/distributor-training-records?distributorId=${distA.body.data.id}`), viewer).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].computedStatus).toBe('valid')

      const trainedStatus = await authed(request(httpServer(app)).get(`/api/v1/distributor-training-records/status/${distA.body.data.id}`), viewer).expect(200)
      expect(trainedStatus.body.data.status).toBe('valid')
      expect(trainedStatus.body.data.record.id).toBe(recordId)

      const audit = await testPrisma.auditEntry.findFirst({ where: { action: 'distributor_training_record_logged', recordId } })
      expect(audit).toBeTruthy()
    })

    it('reflects an expired training as expired, both in the list and the per-distributor status', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15K', ['reconciliation.manage', 'reconciliation.view'])
      const dist = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Lapsed Distribution Ltd' }).expect(201)

      await authedWrite(request(httpServer(app)).post('/api/v1/distributor-training-records'), manager)
        .send({
          distributorId: dist.body.data.id,
          trainingType: 'pv_annual',
          title: 'Last year\'s training',
          completionDate: '2024-01-01',
          expiryDate: '2025-01-01',
        })
        .expect(201)

      const status = await authed(request(httpServer(app)).get(`/api/v1/distributor-training-records/status/${dist.body.data.id}`), manager).expect(200)
      expect(status.body.data.status).toBe('expired')
    })
  })

  describe('Stage 15.1 — Reconciliation: auto-match, manual mapping, report generation', () => {
    it('auto-matches cases by Reporter.organization, flags the rest as unmatched, and a generated report totals correctly', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15C', ['reconciliation.manage', 'pv.capture_case'])
      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(201)

      await createCase(manager, 'Acme Distribution Ltd', '2026-08-10')
      await createCase(manager, '  acme distribution ltd  ', '2026-08-11') // case-insensitive, trimmed
      const unmatchedCaseId = await createCase(manager, 'Some Unrelated Org', '2026-08-12')

      const unmatched = await authed(request(httpServer(app)).get('/api/v1/reconciliation/unmatched?periodStart=2026-08-01&periodEnd=2026-08-31'), manager).expect(200)
      expect(unmatched.body.data).toHaveLength(1)
      expect(unmatched.body.data[0].caseId).toBe(unmatchedCaseId)

      const report = await authedWrite(request(httpServer(app)).post('/api/v1/reconciliation/reports'), manager).send({ periodStart: '2026-08-01', periodEnd: '2026-08-31' }).expect(201)
      expect(report.body.data.totalCases).toBe(3)
      expect(report.body.data.matchedCases).toBe(2)
      expect(report.body.data.unmatchedCases).toBe(1)

      const listed = await authed(request(httpServer(app)).get('/api/v1/reconciliation/reports'), manager).expect(200)
      expect(listed.body.data).toHaveLength(1)
      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reconciliation/reports/${report.body.data.id}`), manager).expect(200)
      expect(fetched.body.data.id).toBe(report.body.data.id)
    })

    it('a manual mapping removes a case from the unmatched queue, including a confirmed "not distributor-sourced" (null) mapping', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15D', ['reconciliation.manage', 'pv.capture_case'])
      const caseId = await createCase(manager, 'Totally Unrecognized Org', '2026-08-10')

      const before = await authed(request(httpServer(app)).get('/api/v1/reconciliation/unmatched?periodStart=2026-08-01&periodEnd=2026-08-31'), manager).expect(200)
      expect(before.body.data).toHaveLength(1)

      await authedWrite(request(httpServer(app)).post(`/api/v1/reconciliation/cases/${caseId}`), manager).send({ note: 'Confirmed direct HCP report, not distributor-sourced' }).expect(201)

      const after = await authed(request(httpServer(app)).get('/api/v1/reconciliation/unmatched?periodStart=2026-08-01&periodEnd=2026-08-31'), manager).expect(200)
      expect(after.body.data).toHaveLength(0)
    })

    it('a distributor-scoped report only counts that distributor\'s own cases, with zero unmatchedCases', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15E', ['reconciliation.manage', 'pv.capture_case'])
      const distA = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Distributor A' }).expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Distributor B' }).expect(201)

      await createCase(manager, 'Distributor A', '2026-08-10')
      await createCase(manager, 'Distributor B', '2026-08-11')
      await createCase(manager, null, '2026-08-12')

      const report = await authedWrite(request(httpServer(app)).post('/api/v1/reconciliation/reports'), manager)
        .send({ distributorId: distA.body.data.id, periodStart: '2026-08-01', periodEnd: '2026-08-31' })
        .expect(201)
      expect(report.body.data.totalCases).toBe(1)
      expect(report.body.data.matchedCases).toBe(1)
      expect(report.body.data.unmatchedCases).toBe(0)
    })
  })

  describe('Stage 15.1 — Platform-only tenant linking + cross-tenant auto-reconciliation', () => {
    it('a tenant cannot set distributorCompanyId itself — the field does not exist on the create DTO at all, and the app-wide forbidNonWhitelisted pipe rejects the whole request rather than silently stripping it', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15F', ['reconciliation.manage'])
      await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager)
        .send({ name: 'Acme Distribution Ltd', distributorCompanyId: randomUUID() })
        .expect(400)

      // A request with only the real fields still succeeds, confirming the 400 above was specifically about the extra field, not something else.
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(201)
      const stored = await withBypass((tx) => tx.distributor.findUniqueOrThrow({ where: { id: created.body.data.id } }))
      expect(stored.distributorCompanyId).toBeNull()
    })

    it('platform super_admin can link/unlink a distributor to a real tenant; a plain tenant actor and operations both get 403', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15G', ['reconciliation.manage'])
      const superAdmin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })
      const operationsStaff = await createAuthenticatedActor(app, testPrisma, { platformRole: 'operations' })

      const distributor = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(201)

      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const distributorTenantId = randomUUID()
      await testPrisma.company.create({ data: { id: distributorTenantId, name: 'Distributor Tenant Co', companyType: 'importer_distributor', homeCountryId: otherCountryId, status: 'active' } })

      await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), manager).send({ targetCompanyId: distributorTenantId }).expect(403)
      await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), operationsStaff).send({ targetCompanyId: distributorTenantId }).expect(403)

      const linked = await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), superAdmin)
        .send({ targetCompanyId: distributorTenantId })
        .expect(200)
      expect(linked.body.data.distributorCompanyId).toBe(distributorTenantId)

      const unlinked = await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), superAdmin).send({}).expect(200)
      expect(unlinked.body.data.distributorCompanyId).toBeNull()
    })

    // testing-todo 15.1 — real-usage feedback: platform admins need a real
    // way to browse every tenant's distributors and get an auto-match
    // suggestion for the "both sides are real SafeMeds tenants" case,
    // rather than only being able to link a distributor id they already
    // know via curl/the DB. Distributors that will never be a tenant keep
    // using the plain manual link (still exercised above) unchanged.
    it('platform admin can browse distributors across every tenant and get an auto-match suggestion for a same-named real tenant', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15I', ['reconciliation.manage'])
      const superAdmin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

      const distributor = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Pfizer Kenya Ltd' }).expect(201)

      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const realTenantId = randomUUID()
      await testPrisma.company.create({ data: { id: realTenantId, name: 'Pfizer Kenya', companyType: 'importer_distributor', homeCountryId: otherCountryId, status: 'active' } })
      const unrelatedTenantId = randomUUID()
      await testPrisma.company.create({ data: { id: unrelatedTenantId, name: 'Totally Unrelated Co', companyType: 'importer_distributor', homeCountryId: otherCountryId, status: 'active' } })

      interface PlatformDistributorRow {
        id: string
        distributorCompanyId: string | null
        ownerCompanyName: string
      }

      const list = await authed(request(httpServer(app)).get('/api/v1/platform/distributors?unlinkedOnly=true'), superAdmin).expect(200)
      const listData = list.body.data as PlatformDistributorRow[]
      const row = listData.find((d) => d.id === distributor.body.data.id)
      expect(row).toBeDefined()
      expect(row!.distributorCompanyId).toBeNull()
      expect(row!.ownerCompanyName).toBe('Stage15 Test Co')

      const suggestions = await authed(request(httpServer(app)).get(`/api/v1/platform/distributors/${distributor.body.data.id}/suggestions`), superAdmin).expect(200)
      expect(suggestions.body.data).toEqual([{ companyId: realTenantId, companyName: 'Pfizer Kenya' }])

      await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), superAdmin)
        .send({ targetCompanyId: realTenantId })
        .expect(200)

      const afterLink = await authed(request(httpServer(app)).get('/api/v1/platform/distributors?unlinkedOnly=true'), superAdmin).expect(200)
      const afterLinkData = afterLink.body.data as PlatformDistributorRow[]
      expect(afterLinkData.find((d) => d.id === distributor.body.data.id)).toBeUndefined()
    })

    it('cross-tenant summary is unavailable until linked, then returns both counts and audits both tenants', async () => {
      const manager = await actorWith('QUALITY_MANAGER_15H', ['reconciliation.manage', 'pv.capture_case'])
      const superAdmin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

      const distributor = await authedWrite(request(httpServer(app)).post('/api/v1/distributors'), manager).send({ name: 'Acme Distribution Ltd' }).expect(201)
      await createCase(manager, 'Acme Distribution Ltd', '2026-08-10')

      await authed(request(httpServer(app)).get(`/api/v1/reconciliation/distributors/${distributor.body.data.id}/cross-tenant-summary?periodStart=2026-08-01&periodEnd=2026-08-31`), manager).expect(403)

      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const distributorTenantId = randomUUID()
      await testPrisma.company.create({ data: { id: distributorTenantId, name: 'Distributor Tenant Co', companyType: 'importer_distributor', homeCountryId: otherCountryId, status: 'active' } })
      const distributorTenantReportTypeId = randomUUID()
      await testPrisma.reportType.create({ data: { id: distributorTenantReportTypeId, typeKey: 'adr_dt', name: 'ADR (distributor tenant)' } })
      const distributorActor = await createAuthenticatedActor(app, testPrisma, { companyId: distributorTenantId, roleKeys: ['DISPENSING_PHARMACIST'] })
      await seedRoleWithPermissions('DISPENSING_PHARMACIST', ['pv.capture_case'])

      await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), distributorActor)
        .send({
          reportTypeId: distributorTenantReportTypeId,
          countryOfOccurrenceId: otherCountryId,
          countryOfReportId: otherCountryId,
          channel: 'form',
          awarenessDate: '2026-08-12',
          receivedDate: '2026-08-12',
          reporter: { reporterType: 'consumer' },
          patient: { initials: 'A.B.' },
          suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Amoxil' }],
          adverseEvents: [{ reportedTerm: 'Nausea', narrative: 'Felt nauseous' }],
        })
        .expect(201)

      await authedWrite(request(httpServer(app)).patch(`/api/v1/platform/distributors/${distributor.body.data.id}/link-tenant`), superAdmin).send({ targetCompanyId: distributorTenantId }).expect(200)

      const summary = await authed(request(httpServer(app)).get(`/api/v1/reconciliation/distributors/${distributor.body.data.id}/cross-tenant-summary?periodStart=2026-08-01&periodEnd=2026-08-31`), manager).expect(200)
      expect(summary.body.data.manufacturerMatchedCaseCount).toBe(1)
      expect(summary.body.data.distributorTenantCaseCount).toBe(1)

      const manufacturerAudit = await withBypass((tx) => tx.auditEntry.findFirst({ where: { companyId, action: 'reconciliation_cross_tenant_read' } }))
      expect(manufacturerAudit).toBeTruthy()
      const distributorAudit = await withBypass((tx) => tx.auditEntry.findFirst({ where: { companyId: distributorTenantId, action: 'reconciliation_cross_tenant_read_by_manufacturer' } }))
      expect(distributorAudit).toBeTruthy()
    })
  })

  describe('Stage 15.2 — Contact Testing two-trigger retry cycle', () => {
    it('starts an email test with a real ~5-day window and a phone test with an immediate window', async () => {
      const qppv = await actorWith('QPPV_15I', ['contact_testing.manage'])

      const before = Date.now()
      const emailTest = await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), qppv)
        .send({ channel: 'email', contactValue: 'safety@stage15.test', purpose: 'Drug safety mailbox' })
        .expect(201)
      const windowMs = new Date(emailTest.body.data.windowDueAt as string).getTime() - before
      expect(windowMs).toBeGreaterThan(4.9 * 24 * 60 * 60 * 1000)
      expect(windowMs).toBeLessThan(5.1 * 24 * 60 * 60 * 1000)

      const phoneTest = await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), qppv)
        .send({ channel: 'phone', contactValue: '+254700000000', purpose: 'QPPV after-hours hotline' })
        .expect(201)
      const phoneWindowMs = new Date(phoneTest.body.data.windowDueAt as string).getTime() - before
      expect(phoneWindowMs).toBeLessThan(5000)
    })

    it('reached on the first attempt closes the test immediately — "good and dusted"', async () => {
      const qppv = await actorWith('QPPV_15J', ['contact_testing.manage'])
      const test = await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), qppv).send({ channel: 'phone', contactValue: '+254700000000' }).expect(201)

      const logged = await authedWrite(request(httpServer(app)).post(`/api/v1/contact-tests/${test.body.data.id}/log-attempt`), qppv).send({ outcome: 'reached' }).expect(201)
      expect(logged.body.data.status).toBe('reached')
      expect(logged.body.data.attemptCount).toBe(1)

      // Logging again against an already-resolved test is rejected.
      await authedWrite(request(httpServer(app)).post(`/api/v1/contact-tests/${test.body.data.id}/log-attempt`), qppv).send({ outcome: 'reached' }).expect(409)
    })

    it('two no_response attempts closes the test as unsuccessful — "rejected"', async () => {
      const qppv = await actorWith('QPPV_15K', ['contact_testing.manage'])
      const test = await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), qppv).send({ channel: 'phone', contactValue: '+254700000000' }).expect(201)

      const first = await authedWrite(request(httpServer(app)).post(`/api/v1/contact-tests/${test.body.data.id}/log-attempt`), qppv).send({ outcome: 'no_response' }).expect(201)
      expect(first.body.data.status).toBe('pending_attempt_2')

      const second = await authedWrite(request(httpServer(app)).post(`/api/v1/contact-tests/${test.body.data.id}/log-attempt`), qppv).send({ outcome: 'no_response' }).expect(201)
      expect(second.body.data.status).toBe('unsuccessful')

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/contact-tests/${test.body.data.id}`), qppv).expect(200)
      expect(fetched.body.data.attempts).toHaveLength(2)
    })

    it('is gated by contact_testing.manage', async () => {
      const noAccess = await actorWith('DISPENSING_PHARMACIST_15L', [])
      await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), noAccess).send({ channel: 'phone', contactValue: '+254700000000' }).expect(403)
      await authed(request(httpServer(app)).get('/api/v1/contact-tests'), noAccess).expect(403)
    })

    it('the daily sweep settles a test whose window has elapsed with nothing logged', async () => {
      const qppv = await actorWith('QPPV_15M', ['contact_testing.manage'])
      const test = await authedWrite(request(httpServer(app)).post('/api/v1/contact-tests'), qppv).send({ channel: 'email', contactValue: 'safety@stage15.test' }).expect(201)

      await withBypass((tx) => tx.contactTest.update({ where: { id: test.body.data.id }, data: { windowDueAt: new Date(Date.now() - 1000) } }))

      const { ContactTestService } = await import('../src/modules/contact-testing/contact-test.service')
      const contactTestService = app.get(ContactTestService)
      const result = await contactTestService.processDue()
      expect(result.settled).toBeGreaterThanOrEqual(1)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/contact-tests/${test.body.data.id}`), qppv).expect(200)
      expect(fetched.body.data.status).toBe('pending_attempt_2')
      expect(fetched.body.data.attempts[0].loggedBy).toBeNull()
    })
  })
})
