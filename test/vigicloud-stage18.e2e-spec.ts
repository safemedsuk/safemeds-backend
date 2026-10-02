import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { PutObjectResult, StorageService, VerifiedObject } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[], isPlatform = false): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({ where: { key }, update: {}, create: { id: randomUUID(), key, description: 'e2e fixture' } })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
}

/** Same fake used by every prior stage's own e2e spec — see `documents-upload.e2e-spec.ts` for why a real R2 call can't run inside Jest e2e. */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>()

  putObject(key: string, body: Buffer, _contentType: string): Promise<PutObjectResult> {
    this.objects.set(key, body)
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }

  verifyObject(key: string): Promise<VerifiedObject> {
    const body = this.objects.get(key)
    if (!body) return Promise.reject(new Error('NoSuchKey'))
    return Promise.resolve({ sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }

  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_DOWNLOAD:${key}`)
  }

  presignUpload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_UPLOAD:${key}`)
  }
}

function buildCasePayload(overrides: Record<string, unknown> = {}, refs: { reportTypeId: string; countryId: string; productId: string }) {
  return {
    reportTypeId: refs.reportTypeId,
    countryOfOccurrenceId: refs.countryId,
    countryOfReportId: refs.countryId,
    channel: 'form',
    awarenessDate: '2026-03-01',
    receivedDate: '2026-03-02',
    reporter: { reporterType: 'consumer', fullName: 'A Reporter', email: 'reporter@example.com' },
    patient: { initials: 'J.M.', ageYears: 34, sex: 'female' },
    suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Depo-Provera', activeSubstanceName: 'Medroxyprogesterone', productId: refs.productId }],
    adverseEvents: [{ reportedTerm: 'Injection site reaction', narrative: 'Localized reaction within an hour of dosing' }],
    ...overrides,
  }
}

/**
 * VigiCloud Stage 18 — Reporting & Periodic Outputs. Real HTTP coverage
 * against a real seeded company, matching every prior stage's own e2e
 * conventions. Self-contained (doesn't depend on `pnpm prisma:seed`).
 */
describe('VigiCloud Stage 18 — Reporting & Periodic Outputs (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let reportTypeId: string
  let qppv: TestActor

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(StorageService).useValue(new FakeStorageService()))
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Stage18 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({ data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' } })

    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
    const definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const intakeId = randomUUID()
    const triageId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
        { id: triageId, definitionId, stateKey: 'triage', name: 'Triage', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.create({
      data: { id: randomUUID(), definitionId, fromStateId: intakeId, toStateId: triageId, requiredRoleId: superintendentRoleId, requiresSignature: false },
    })

    // Real-usage request, 11 Sep 2026 — `PeriodicReportService.generate()`
    // now instantiates a real `periodic_report` workflow instance on every
    // call, so this file (like every e2e spec) needs its own minimal
    // fixture for it, matching the `pv_case` one immediately above.
    const qualityAssociateRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: qualityAssociateRoleId, key: 'QUALITY_ASSOCIATE', name: 'Quality Associate', description: 'e2e fixture', isPlatform: false } })
    const qppvRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: qppvRoleId, key: 'QPPV', name: 'QPPV', description: 'e2e fixture', isPlatform: false } })
    const periodicReportDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: periodicReportDefinitionId, recordType: 'periodic_report', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const draftId = randomUUID()
    const qcReviewedId = randomUUID()
    const periodicSubmittedId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: draftId, definitionId: periodicReportDefinitionId, stateKey: 'draft', name: 'Draft', isInitial: true, isTerminal: false },
        { id: qcReviewedId, definitionId: periodicReportDefinitionId, stateKey: 'qc_reviewed', name: 'QC Reviewed', isInitial: false, isTerminal: false },
        { id: periodicSubmittedId, definitionId: periodicReportDefinitionId, stateKey: 'submitted', name: 'Submitted', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId: periodicReportDefinitionId, fromStateId: draftId, toStateId: qcReviewedId, requiredRoleId: qualityAssociateRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId: periodicReportDefinitionId, fromStateId: qcReviewedId, toStateId: periodicSubmittedId, requiredRoleId: qppvRoleId, requiresSignature: true },
      ],
    })

    await seedRoleWithPermissions('QPPV_18', [
      'pv.capture_case',
      'pv.view_all',
      'master_data.view',
      'master_data.manage',
      'documents.view',
      'documents.manage',
      'consent.manage',
      'reports.view',
      'reports.manage',
      'rmp.view',
      'rmp.manage',
      'safety_alerts.view',
      'safety_alerts.manage',
    ])
    qppv = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QPPV_18'] })
  })

  async function createProduct(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await authedWrite(request(httpServer(app)).post('/api/v1/products'), qppv)
      .send({ brandName: 'Depo-Provera', genericName: 'Medroxyprogesterone acetate', productCategory: 'medicinal', dosageForm: 'injection', strength: '150mg/mL', ...overrides })
      .expect(201)
    return res.body.data.id as string
  }

  async function createCase(productId: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await authedWrite(request(httpServer(app)).post('/api/v1/pv/cases'), qppv)
      .send(buildCasePayload(overrides, { reportTypeId, countryId, productId }))
      .expect(201)
    return created.body.data.id as string
  }

  async function uploadDocumentFor(recordType: string, recordId: string, title: string): Promise<string> {
    const res = await authedWrite(request(httpServer(app)).post(`/api/v1/records/${recordType}/${recordId}/documents/upload`), qppv)
      .field('title', title)
      .attach('file', Buffer.from(`%PDF-1.4\n${title}\n`), { filename: 'evidence.pdf', contentType: 'application/pdf' })
      .expect(201)
    return res.body.data.document.id as string
  }

  describe('Dashboard', () => {
    it('reflects real open cases and zero everything-else on a fresh company', async () => {
      await createProduct()
      const productId = await createProduct({ brandName: 'Second Product' })
      await createCase(productId)

      const res = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), qppv).expect(200)
      expect(res.body.data.cases.totalOpen).toBe(1)
      expect(res.body.data.cases.byState).toEqual(expect.arrayContaining([expect.objectContaining({ stateKey: 'intake', count: 1 })]))
      expect(res.body.data.signals.open).toBe(0)
      expect(res.body.data.rmpRenewalsDue).toBe(0)
      expect(res.body.data.safetyAlertsOpen).toBe(0)
    })
  })

  describe('Benefit-Risk', () => {
    it('aggregates real case data for a product', async () => {
      const productId = await createProduct()
      await createCase(productId)
      await createCase(productId)

      const res = await authed(request(httpServer(app)).get(`/api/v1/reporting/benefit-risk/${productId}`), qppv).expect(200)
      expect(res.body.data.caseCount).toBe(2)
    })
  })

  describe('Line Listing', () => {
    it('generates a custom-range line listing with real case data', async () => {
      const productId = await createProduct()
      await createCase(productId)

      const res = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/line-listings'), qppv)
        .send({ countryId, periodStart: '2026-01-01', periodEnd: '2026-06-01' })
        .expect(201)
      expect(res.body.data.reportTypeKey).toBe('line_listing')
      expect(res.body.data.status).toBe('final')
    })

    it('rejects a cadence-based generation with no configured rule', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/line-listings'), qppv).send({ countryId }).expect(409)
    })

    it('generates from a configured cadence once the period has elapsed, and rejects a second call before the next period elapses', async () => {
      const authorityId = randomUUID()
      await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB_18', name: 'Pharmacy and Poisons Board' } })
      const lineListingReportTypeId = randomUUID()
      await testPrisma.reportType.create({ data: { id: lineListingReportTypeId, typeKey: 'line_listing', name: 'Periodic Line Listing' } })
      await testPrisma.reportingRule.create({
        data: {
          id: randomUUID(),
          authorityId,
          reportTypeId: lineListingReportTypeId,
          seriousnessClass: 'periodic',
          windowDays: 7,
          reportingPeriodDays: 7,
          status: 'active',
          effectiveFrom: new Date('2026-01-01'),
        },
      })

      const first = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/line-listings'), qppv).send({ countryId }).expect(201)
      expect(first.body.data.reportTypeKey).toBe('line_listing')

      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/line-listings'), qppv).send({ countryId }).expect(409)
    })

    // testing-todo 18.3 — the test above proves `LineListingService` itself
    // works correctly given a rule (inserted directly via `testPrisma`); this
    // one proves the *other* half — that a platform admin using the real
    // Admin Configuration Console endpoints (create → activate, the same
    // `POST /country-config/reporting-rules(/:id/activate)` path the
    // frontend's `CreateReportingRuleForm` calls) can actually produce a rule
    // `LineListingService` picks up, closing the loop CLAUDE.md's own Gap 1
    // writeup asserted but never verified end-to-end.
    it('a reporting rule created and activated through the real Admin Configuration Console endpoints produces a working line-listing cadence', async () => {
      await seedRoleWithPermissions('regulatory_lead', ['platform.config.manage'], true)
      const admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'regulatory_lead' })

      const authorityId = randomUUID()
      await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB_18B', name: 'Pharmacy and Poisons Board' } })
      const lineListingReportTypeId = randomUUID()
      await testPrisma.reportType.create({ data: { id: lineListingReportTypeId, typeKey: 'line_listing', name: 'Periodic Line Listing' } })

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/country-config/reporting-rules'), admin).send({
        authorityId,
        reportTypeId: lineListingReportTypeId,
        seriousnessClass: 'periodic',
        windowDays: 7,
        reportingPeriodDays: 7,
        unverified: false,
        sourceReference: 'e2e fixture',
        effectiveFrom: '2026-01-01',
      })
      expect(created.status).toBe(201)

      const activated = await authedWrite(request(httpServer(app)).post(`/api/v1/country-config/reporting-rules/${created.body.data.id}/activate`), admin)
      expect(activated.status).toBe(201)
      expect(activated.body.data.status).toBe('active')

      const generated = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/line-listings'), qppv).send({ countryId }).expect(201)
      expect(generated.body.data.reportTypeKey).toBe('line_listing')
    })
  })

  describe('Periodic Reports', () => {
    it('rejects a PSUR for a product with no international birth date', async () => {
      const productId = await createProduct()
      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv).send({ reportTypeKey: 'psur', productId }).expect(409)
    })

    it('generates a PSUR once the Data Lock Point is reached, using the real EURD cadence', async () => {
      const productId = await createProduct({ internationalBirthDate: '2020-01-01' })
      await createCase(productId)

      const res = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv).send({ reportTypeKey: 'psur', productId, conclusionNote: 'No new signal identified.' }).expect(201)
      expect(res.body.data.reportTypeKey).toBe('psur')
      expect(res.body.data.periodStart).toBe('2020-01-01T00:00:00.000Z')
      expect(res.body.data.dueAt).not.toBeNull()
    })

    it('rejects a PSUR whose Data Lock Point has not been reached yet', async () => {
      const productId = await createProduct({ internationalBirthDate: new Date().toISOString().slice(0, 10) })
      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv).send({ reportTypeKey: 'psur', productId }).expect(409)
    })

    it('rejects a PADER with no explicit period', async () => {
      const productId = await createProduct()
      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv).send({ reportTypeKey: 'pader', productId }).expect(400)
    })

    it('generates a PADER with an explicit custom period', async () => {
      const productId = await createProduct()
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv)
        .send({ reportTypeKey: 'pader', productId, periodStart: '2026-01-01', periodEnd: '2026-04-01' })
        .expect(201)
      expect(res.body.data.reportTypeKey).toBe('pader')
      expect(res.body.data.dueAt).toBeNull()
    })

    it('walks a real periodic_report workflow instance: draft -> QC review -> QPPV sign-off+submit, then attaches evidence — real-usage request, 11 Sep 2026', async () => {
      const productId = await createProduct({ brandName: 'Third Product' })

      const generated = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/periodic-reports'), qppv)
        .send({ reportTypeKey: 'pader', productId, periodStart: '2026-01-01', periodEnd: '2026-04-01' })
        .expect(201)
      const reportId = generated.body.data.id as string
      const instanceId = generated.body.data.workflowInstanceId as string
      expect(instanceId).toBeTruthy()
      expect(generated.body.data.status).toBe('draft')

      await seedRoleWithPermissions('QUALITY_ASSOCIATE', ['reports.view'])
      await seedRoleWithPermissions('QPPV', ['reports.view', 'reports.manage', 'documents.manage', 'signatures.read'])
      const qualityAssociate = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })
      const signingQppv = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QPPV'] })

      // The generic finalize/submit shortcut must be blocked once a real workflow instance exists.
      const blockedFinalize = await authedWrite(request(httpServer(app)).post(`/api/v1/reports/${reportId}/finalize`), qppv).expect(409)
      expect(blockedFinalize.body.error.code).toBe('USE_WORKFLOW_ACTIONS')

      const reviewed = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), qualityAssociate)
        .send({ toStateKey: 'qc_reviewed' })
        .expect(201)
      expect(reviewed.body.data.id).toBe(instanceId)

      const midCheck = await authed(request(httpServer(app)).get(`/api/v1/reports/${reportId}`), qppv).expect(200)
      expect(midCheck.body.data.status).toBe('qc_reviewed')

      const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
      const signatureTokenService = app.get(SignatureTokenService)
      const signatureToken = await signatureTokenService.issue(signingQppv.userId)
      const submitted = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`), signingQppv)
        .send({ toStateKey: 'submitted', signatureToken, intentStatement: 'I approve and submit this PADER' })
        .expect(201)
      expect(submitted.body.data.id).toBe(instanceId)

      const afterSubmit = await authed(request(httpServer(app)).get(`/api/v1/reports/${reportId}`), qppv).expect(200)
      expect(afterSubmit.body.data.status).toBe('submitted')
      expect(afterSubmit.body.data.submittedAt).not.toBeNull()

      const evidence = await authedWrite(request(httpServer(app)).post(`/api/v1/reporting/periodic-reports/${reportId}/evidence`), qppv)
        .attach('file', Buffer.from('%PDF-1.4\nportal confirmation\n'), { filename: 'confirmation.pdf', contentType: 'application/pdf' })
        .expect(201)
      expect(evidence.body.data.evidenceDocumentId).toBeTruthy()
    })
  })

  describe('Risk Management Plan', () => {
    it('walks the full version-on-write cycle: draft, attach document, activate, list, update renewal', async () => {
      const productId = await createProduct()

      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/rmp'), qppv).send({ productId, title: 'RMP v1' }).expect(201)
      expect(draft.body.data.version).toBe(1)
      expect(draft.body.data.status).toBe('draft')

      await authedWrite(request(httpServer(app)).post(`/api/v1/rmp/${draft.body.data.id}/activate`), qppv).expect(409)

      const rmpId = draft.body.data.id as string
      const documentId = await uploadDocumentFor('risk_management_plan', rmpId, 'RMP document')
      await authedWrite(request(httpServer(app)).post(`/api/v1/rmp/${rmpId}/document`), qppv).send({ documentId }).expect(201)

      const activated = await authedWrite(request(httpServer(app)).post(`/api/v1/rmp/${rmpId}/activate`), qppv).expect(201)
      expect(activated.body.data.status).toBe('active')

      const list = await authed(request(httpServer(app)).get(`/api/v1/rmp?productId=${productId}`), qppv).expect(200)
      expect(list.body.data).toHaveLength(1)

      const renewed = await authedWrite(request(httpServer(app)).patch(`/api/v1/rmp/${rmpId}/renewal`), qppv).send({ nextRenewalDueAt: '2027-06-01' }).expect(200)
      expect((renewed.body.data.nextRenewalDueAt as string).slice(0, 10)).toBe('2027-06-01')

      const dashboard = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), qppv).expect(200)
      expect(dashboard.body.data.rmpRenewalsDue).toBe(0) // due date is >90 days out
    })

    it('real-usage request, 22 Sep 2026 (item 8) — bulk-imports RMPs for several existing products via the generic Stage 0.6 importer framework', async () => {
      const productOneId = await createProduct({ brandName: 'BulkRmpProductOne' })
      const productTwoId = await createProduct({ brandName: 'BulkRmpProductTwo' })

      const csvText =
        'Product Brand Name,RMP Title,Summary,Next Renewal Due\n' +
        'BulkRmpProductOne,BulkRmpProductOne RMP v1,Standard risk minimisation measures,2027-01-01\n' +
        'BulkRmpProductTwo,BulkRmpProductTwo RMP v1,Standard risk minimisation measures,2027-06-01\n' +
        'NoSuchProduct,Should fail,,\n'

      const preview = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/risk_management_plan/preview'), qppv)
        .send({ csvText })
        .expect(201)
      const validRows = preview.body.data.validRows as { data: Record<string, string> }[]
      expect(validRows).toHaveLength(3) // "NoSuchProduct" passes row-shape validation — it only fails at commit, resolving the product

      const commit = await authedWrite(request(httpServer(app)).post('/api/v1/bulk-import/risk_management_plan/commit'), qppv)
        .send({ rows: validRows.map((r) => r.data) })
        .expect(201)
      expect(commit.body.data.committed).toBe(2)
      expect(commit.body.data.failed).toHaveLength(1)
      expect(commit.body.data.failed[0].error).toMatch(/No active product found/)

      const rmpsForOne = await authed(request(httpServer(app)).get(`/api/v1/rmp?productId=${productOneId}`), qppv).expect(200)
      expect(rmpsForOne.body.data).toHaveLength(1)
      expect(rmpsForOne.body.data[0].title).toBe('BulkRmpProductOne RMP v1')
      expect(rmpsForOne.body.data[0].status).toBe('draft') // never auto-activated

      const rmpsForTwo = await authed(request(httpServer(app)).get(`/api/v1/rmp?productId=${productTwoId}`), qppv).expect(200)
      expect(rmpsForTwo.body.data).toHaveLength(1)
      expect(rmpsForTwo.body.data[0].title).toBe('BulkRmpProductTwo RMP v1')
    })
  })

  describe('Safety Alerts & Letters', () => {
    it('logs an alert, generates a DHCP letter, and dispatches it to every recipient', async () => {
      const alert = await authedWrite(request(httpServer(app)).post('/api/v1/safety-alerts'), qppv)
        .send({ title: 'Batch withdrawal notice', source: 'WHO Medical Product Alert', summary: 'A batch was recalled abroad.' })
        .expect(201)
      expect(alert.body.data.status).toBe('open')

      const dashboard = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), qppv).expect(200)
      expect(dashboard.body.data.safetyAlertsOpen).toBe(1)

      const letter = await authedWrite(request(httpServer(app)).post('/api/v1/safety-letters'), qppv)
        .send({
          safetyAlertId: alert.body.data.id,
          letterType: 'dhcp',
          ppbApprovalReference: 'PPB/2026/E2E-01',
          backgroundInformation: 'Three units from this batch failed sterility testing abroad.',
          actionableGuidance: 'Please stop dispensing this batch immediately.',
          signatoryName: 'Dr. Amina QPPV',
          recipients: [{ name: 'Dr A', email: 'dr.a@example.com' }, { name: 'Dr B', email: 'dr.b@example.com' }],
        })
        .expect(201)
      const letterId = letter.body.data.id as string
      const initialRecipients = letter.body.data.recipients as { sentAt: string | null }[]
      expect(letter.body.data.reportTypeKey).toBe('dhcp_letter')
      expect(initialRecipients).toHaveLength(2)
      expect(initialRecipients.every((r) => r.sentAt === null)).toBe(true)

      const dispatched = await authedWrite(request(httpServer(app)).post(`/api/v1/safety-letters/${letterId}/dispatch`), qppv).expect(201)
      const dispatchedRecipients = dispatched.body.data.recipients as { sentAt: string | null }[]
      expect(dispatchedRecipients.every((r) => r.sentAt !== null)).toBe(true)

      await authedWrite(request(httpServer(app)).patch(`/api/v1/safety-alerts/${alert.body.data.id}/status`), qppv).send({ status: 'actioned', reviewNote: 'DHCP letter sent.' }).expect(200)

      const finalDashboard = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), qppv).expect(200)
      expect(finalDashboard.body.data.safetyAlertsOpen).toBe(0)
    })
  })

  describe('Permissions', () => {
    it('rejects dashboard access with no reports.view', async () => {
      await seedRoleWithPermissions('NO_REPORTS_18', [])
      const noAccess = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['NO_REPORTS_18'] })
      await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), noAccess).expect(403)
    })

    it('rejects RMP management with only rmp.view', async () => {
      await seedRoleWithPermissions('RMP_VIEW_ONLY_18', ['rmp.view'])
      const viewOnly = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['RMP_VIEW_ONLY_18'] })
      await authedWrite(request(httpServer(app)).post('/api/v1/rmp'), viewOnly).send({ productId: randomUUID(), title: 'x' }).expect(403)
      await authed(request(httpServer(app)).get('/api/v1/rmp'), viewOnly).expect(200)
    })
  })
})
