import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud (Phase 13) Stage 8 (Metrics, Trending & Management Review)
 * and Stage 9 (Audit & Inspection Management), exercised end-to-end
 * against the real running app and real Postgres.
 */
describe('QualCloud Stages 8-9 — Metrics/Trending/Management Review, Audit & Inspection (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let authorityId: string
  let manager: TestActor
  let associate: TestActor
  let admin: TestActor

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
    countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    authorityId = newId()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'QualCloud Stage8-9 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.manage_capa',
      'quality.close_capa',
      'quality.view_metrics',
      'quality.manage_management_review',
      'company_profile.manage',
      'quality.manage_suppliers',
    ])
    await seedRole('QUALITY_ASSOCIATE', ['quality.view_all', 'quality.manage_capa', 'quality.view_metrics'])

    const platformRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true } })
    const platformPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: platformPermissionId, key: 'platform.config.manage', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: platformPermissionId } })

    manager = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_MANAGER'] })
    associate = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })
  })

  async function createCapa(actor: TestActor, rootCauseCategory: string) {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), actor)
      .send({ title: 'Test CAPA', correctiveAction: 'Fix it', rootCauseCategory })
      .expect(201)
    return res.body.data.id as string
  }

  describe('Stage 8 — Quality Metrics & Trend Detection', () => {
    it('computes live metrics over a real period', async () => {
      await createCapa(manager, 'packaging_defect')

      const res = await authed(request(httpServer(app)).get('/api/v1/quality-metrics'), associate).expect(200)
      expect(res.body.data.capasOpened).toBeGreaterThanOrEqual(1)
      expect(res.body.data.periodStart).toBeDefined()
      expect(res.body.data.periodEnd).toBeDefined()
    })

    it('opens a real trend flag once 3 CAPAs share the same root cause category, notifies QUALITY_MANAGER, and can be acknowledged', async () => {
      await createCapa(manager, 'packaging_defect')
      await createCapa(manager, 'packaging_defect')
      await createCapa(manager, 'packaging_defect')

      const scan = await authedWrite(request(httpServer(app)).post('/api/v1/quality-metrics/trend-flags/run-now'), associate).expect(201)
      expect(scan.body.data.flagsOpened).toBeGreaterThanOrEqual(1)

      const flags = await authed(request(httpServer(app)).get('/api/v1/quality-metrics/trend-flags'), associate).expect(200)
      const flagRows = flags.body.data as { id: string; rootCauseCategory: string; occurrenceCount: number }[]
      const flag = flagRows.find((f) => f.rootCauseCategory === 'packaging_defect')
      expect(flag).toBeDefined()
      expect(flag!.occurrenceCount).toBe(3)

      const notifications = await authed(request(httpServer(app)).get('/api/v1/notifications'), manager).expect(200)
      expect(
        (notifications.body.data.rows as { title: string }[]).some((n) => n.title.includes('Quality trend detected')),
      ).toBe(true)

      const ack = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality-metrics/trend-flags/${flag!.id}/acknowledge`),
        manager,
      ).expect(200)
      expect(ack.body.data.acknowledgedBy).toBeDefined()

      // Associate lacks quality.manage_management_review — acknowledging is denied.
      await authedWrite(
        request(httpServer(app)).patch(`/api/v1/quality-metrics/trend-flags/${flag!.id}/acknowledge`),
        associate,
      ).expect(403)
    })

    it('does not flag when only 2 CAPAs share a root cause category', async () => {
      await createCapa(manager, 'lone_root_cause')
      await createCapa(manager, 'lone_root_cause')

      await authedWrite(request(httpServer(app)).post('/api/v1/quality-metrics/trend-flags/run-now'), associate).expect(201)
      const flags = await authed(request(httpServer(app)).get('/api/v1/quality-metrics/trend-flags'), associate).expect(200)
      expect((flags.body.data as { rootCauseCategory: string }[]).find((f) => f.rootCauseCategory === 'lone_root_cause')).toBeUndefined()
    })
  })

  describe('Stage 8 — Management Review', () => {
    it('schedules a review with a frozen metrics snapshot, then records agreed actions — one of them opening a real CAPA', async () => {
      await createCapa(manager, 'root-a')

      const scheduled = await authedWrite(request(httpServer(app)).post('/api/v1/management-reviews'), manager)
        .send({ period: 'Q1 2026', reviewDate: '2026-03-31', attendees: 'QA Manager, Ops Lead' })
        .expect(201)
      expect(scheduled.body.data.metricsSnapshot).toBeDefined()
      const reviewId = scheduled.body.data.id as string

      const actioned = await authedWrite(request(httpServer(app)).post(`/api/v1/management-reviews/${reviewId}/actions`), manager)
        .send({
          actions: [
            { description: 'Revalidate packaging line', openCapa: true, rootCauseCategory: 'root-a' },
            { description: 'Update SOP wording' },
          ],
        })
        .expect(201)
      const actions = actioned.body.data.actionsAgreed as { description: string; capaId: string | null }[]
      expect(actions[0].capaId).not.toBeNull()
      expect(actions[1].capaId).toBeNull()

      const capasList = await authed(request(httpServer(app)).get('/api/v1/capas'), manager).expect(200)
      expect(
        (capasList.body.data as { sourceRecordType: string }[]).some((c) => c.sourceRecordType === 'management_review'),
      ).toBe(true)

      // Associate cannot schedule/manage a review (view-only via quality.view_metrics).
      await authedWrite(request(httpServer(app)).post('/api/v1/management-reviews'), associate)
        .send({ period: 'Q2 2026', reviewDate: '2026-06-30' })
        .expect(403)

      const got = await authed(request(httpServer(app)).get(`/api/v1/management-reviews/${reviewId}`), associate).expect(200)
      expect(got.body.data.period).toBe('Q1 2026')
    })
  })

  describe('Stage 9 — Inspection Checklist Template (platform admin)', () => {
    it('platform admin creates and updates a checklist section; a tenant actor cannot', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), admin)
        .send({ authorityId, sectionKey: 'quality_control', title: 'Quality Control' })
        .expect(201)
      expect(created.body.data.unverified).toBe(true)

      const updated = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/inspection-checklist-templates/${created.body.data.id}`),
        admin,
      )
        .send({ guidelineReference: 'GUD/QC §4.1 — confirmed by field expert', unverified: false })
        .expect(200)
      expect(updated.body.data.guidelineReference).toContain('GUD/QC')
      expect(updated.body.data.unverified).toBe(false)

      await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), manager)
        .send({ authorityId, sectionKey: 'other', title: 'Other' })
        .expect(403)

      // Read is open to any authenticated actor.
      const list = await authed(request(httpServer(app)).get(`/api/v1/inspection-checklist-templates?authorityId=${authorityId}`), manager).expect(200)
      expect(list.body.data.length).toBeGreaterThanOrEqual(1)
    })

    it('refuses a duplicate sectionKey for the same authority', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), admin)
        .send({ authorityId, sectionKey: 'premises', title: 'Premises' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), admin)
        .send({ authorityId, sectionKey: 'premises', title: 'Premises Again' })
        .expect(409)
    })
  })

  describe('Stage 9 — Internal Audit scoping, conduct-mode checklist, and inspection readiness', () => {
    it('schedules an internal-scope audit, starts conduct, and records a checklist response', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), admin)
        .send({ authorityId, sectionKey: 'premises', title: 'Premises' })
        .expect(201)

      const audit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'Annual Self-Inspection', scheduledDate: '2026-11-01' })
        .expect(201)
      const auditId = audit.body.data.id as string
      expect(audit.body.data.auditScope).toBe('internal')

      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/internal-audits/${auditId}/checklist/start`), manager).expect(201)
      expect(started.body.data.length).toBeGreaterThanOrEqual(1)
      const responseId = started.body.data[0].id as string

      const afterStart = await authed(request(httpServer(app)).get(`/api/v1/internal-audits/${auditId}`), manager).expect(200)
      expect(afterStart.body.data.status).toBe('in_progress')

      const responded = await authedWrite(request(httpServer(app)).patch(`/api/v1/internal-audits/${auditId}/checklist/${responseId}`), manager)
        .send({ status: 'compliant', observations: 'Clean and well-organized.' })
        .expect(200)
      expect(responded.body.data.status).toBe('compliant')

      const list = await authed(request(httpServer(app)).get(`/api/v1/internal-audits/${auditId}/checklist`), manager).expect(200)
      expect(list.body.data[0].checklistTemplate.title).toBe('Premises')
    })

    it('rejects a supplier-scope audit with no supplier named, and accepts one with a real supplier', async () => {
      const supplier = await authedWrite(request(httpServer(app)).post('/api/v1/quality/suppliers'), manager)
        .send({ name: 'Acme API Supplies', supplierType: 'api_supplier', criticality: 'critical' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'Supplier Audit', scheduledDate: '2026-11-01', auditScope: 'supplier' })
        .expect(400)

      const audit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'Supplier Audit', scheduledDate: '2026-11-01', auditScope: 'supplier', supplierId: supplier.body.data.id })
        .expect(201)
      expect(audit.body.data.supplierId).toBe(supplier.body.data.id)
    })

    it('opens a regulatory-scope inspection response, and refuses one on a non-regulatory audit', async () => {
      const internalAudit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'Internal Audit', scheduledDate: '2026-11-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/internal-audits/${internalAudit.body.data.id}/regulatory-responses`), manager)
        .send({})
        .expect(400)

      const regAudit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'PPB GMP Inspection', scheduledDate: '2026-11-01', auditScope: 'regulatory' })
        .expect(201)
      const auditId = regAudit.body.data.id as string

      const opened = await authedWrite(request(httpServer(app)).post(`/api/v1/internal-audits/${auditId}/regulatory-responses`), manager)
        .send({ responseDueDate: '2026-12-01' })
        .expect(201)
      expect(opened.body.data.auditId).toBe(auditId)

      const list = await authed(request(httpServer(app)).get(`/api/v1/internal-audits/${auditId}/regulatory-responses`), manager).expect(200)
      expect(list.body.data).toHaveLength(1)
    })

    // CLAUDE.md's own documented gotcha (first found building VigiCloud
    // Stage 12): a real R2 upload can fail a raw TLS handshake when
    // triggered from deep inside a Jest e2e test's call chain, even
    // though the identical code path is completely reliable outside
    // Jest — already ruled out (not IPv6, not an AWS-SDK checksum
    // issue) and confirmed not a product bug via manual curl testing
    // against the live dev server in that stage. `.skip()`-ed here for
    // the same reason `RegulatorySubmissionService`'s own e2e tests are
    // — correctness rests on `regulatory-inspection-response.service
    // .spec.ts`'s own mocked-I/O unit coverage ("uploads the evidence
    // file and stamps the submission") instead.
    it.skip('submits a regulatory inspection response with real evidence', async () => {
      const regAudit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), manager)
        .send({ title: 'PPB GMP Inspection', scheduledDate: '2026-11-01', auditScope: 'regulatory' })
        .expect(201)
      const auditId = regAudit.body.data.id as string
      const opened = await authedWrite(request(httpServer(app)).post(`/api/v1/internal-audits/${auditId}/regulatory-responses`), manager)
        .send({ responseDueDate: '2026-12-01' })
        .expect(201)
      const responseId = opened.body.data.id as string

      const submitted = await authedWrite(request(httpServer(app)).post(`/api/v1/internal-audits/${auditId}/regulatory-responses/${responseId}/submit`), manager)
        .field('responseText', 'We have corrected the labeling deficiency.')
        .attach('file', Buffer.from('evidence'), { filename: 'evidence.pdf', contentType: 'application/pdf' })
        .expect(201)
      expect(submitted.body.data.submittedAt).toBeDefined()
      expect(submitted.body.data.evidenceDocumentId).toBeDefined()
    })

    it('reflects an honest, live overall readiness status as real underlying data changes', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/inspection-checklist-templates'), admin)
        .send({ authorityId, sectionKey: 'facility_status', title: 'Premises', mappedRecordType: 'facility_status' })
        .expect(201)

      const before = await authed(request(httpServer(app)).get('/api/v1/inspection-readiness'), manager).expect(200)
      expect(before.body.data.overall).toBe('needs_attention')
      expect((before.body.data.rows as { sectionKey: string; status: string }[]).find((r) => r.sectionKey === 'facility_status')!.status).toBe('needs_attention')

      await authedWrite(request(httpServer(app)).post('/api/v1/facilities'), manager)
        .send({ name: 'Nairobi Site', countryId })
        .expect(201)

      const after = await authed(request(httpServer(app)).get('/api/v1/inspection-readiness'), manager).expect(200)
      expect(after.body.data.overall).toBe('ready')
      expect((after.body.data.rows as { sectionKey: string; status: string }[]).find((r) => r.sectionKey === 'facility_status')!.status).toBe('ready')
    })

    // Same documented R2-in-Jest TLS gotcha as the regulatory-response
    // submit test above — `inspection-readiness.service.spec.ts`'s own
    // "renders a PDF, uploads it, and creates a real
    // InspectionReadinessPack row" test covers this with mocked I/O.
    it.skip('generates a real Inspection Readiness Pack', async () => {
      const pack = await authedWrite(request(httpServer(app)).post('/api/v1/inspection-readiness/packs'), manager).expect(201)
      expect(pack.body.data.pdfDocumentId).toBeDefined()

      const listPacks = await authed(request(httpServer(app)).get('/api/v1/inspection-readiness/packs'), manager).expect(200)
      expect(listPacks.body.data).toHaveLength(1)

      const gotPack = await authed(request(httpServer(app)).get(`/api/v1/inspection-readiness/packs/${pack.body.data.id}`), manager).expect(200)
      expect(gotPack.body.data.snapshot.overall).toBeDefined()
    })
  })
})
