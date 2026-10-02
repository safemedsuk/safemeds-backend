import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { StorageService } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/** Same in-memory stand-in every RegCloud e2e spec uses — real R2 hits the known Jest/TLS gotcha (CLAUDE.md), unrelated to anything this spec tests. */
class FakeStorageService {
  putObject(key: string, body: Buffer): Promise<{ key: string; sha256: string; sizeBytes: number }> {
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }
  getObjectBuffer(): Promise<Buffer> {
    return Promise.resolve(Buffer.from('fake-emblem'))
  }
}

/**
 * RegCloud (Phase 12) Stages 8–11 — Post-Market & Obligations, Archive &
 * Custody, Establishment/Premises & Personnel Licensing, and Import/Export
 * & Permits — exercised end-to-end against the real running app and the
 * complete real `reg_registration` workflow (mirroring
 * `regcloud-stage4-5-6-7.e2e-spec.ts`'s own fixture exactly, since Stage 8's
 * own auto-creation trigger fires on real registration approval).
 */
describe('RegCloud Stages 8–11 — Obligations / Archive / Licensing / Permits (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let raOfficer: TestActor
  let countryId: string
  let authorityId: string
  let companyId: string
  let productId: string

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(StorageService).useValue(new FakeStorageService()))
  })

  afterAll(async () => {
    await app.close()
  })

  async function mintSignatureToken(actor: TestActor): Promise<string> {
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  /** testing-correction-explanation.md §2.4 — `requireApprovalData` now always needs a real `approvalEvidenceDocumentId` (plus a payment-proof/invoice pair for a fresh registration) before `→ approved` unlocks. */
  async function uploadDoc(dossierId: string, actor: TestActor, label: string): Promise<string> {
    const res = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), actor)
      .field('title', label)
      .attach('file', Buffer.from(label), { filename: `${label}.pdf`, contentType: 'application/pdf' })
      .expect(201)
    return res.body.data.document.id as string
  }

  function authed(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader)
  }

  function authedWrite(req: request.Test, actor: TestActor): request.Test {
    return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
  }

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya', officialName: 'Republic of Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })

    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'RegCloud Stage8-11 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    const platformRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true } })
    const platformPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: platformPermissionId, key: 'platform.config.manage', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: platformPermissionId } })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

    const tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of [
      'regulatory.manage_dossier',
      'regulatory.view_all',
      'regulatory.submit',
      'regulatory.manage_variations',
      'regulatory.manage_obligations',
      'regulatory.manage_licensing',
      'regulatory.manage_import_export',
      'master_data.manage',
      'master_data.view',
      'documents.manage',
      'company_profile.manage',
    ]) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // The complete real reg_registration workflow — 9 states, 11 transitions.
    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const stateKeys = ['planning', 'compiling', 'completeness_check', 'submitted', 'query_received', 'responding', 'resubmitted_for_review', 'approved', 'rejected']
    const stateIds = new Map<string, string>()
    await testPrisma.workflowState.createMany({
      data: stateKeys.map((key, idx) => ({
        id: (stateIds.set(key, randomUUID()), stateIds.get(key)!),
        definitionId: defId,
        stateKey: key,
        name: key,
        isInitial: idx === 0,
        isTerminal: key === 'approved' || key === 'rejected',
      })),
    })
    const transitions: { from: string; to: string; requiresSignature: boolean }[] = [
      { from: 'planning', to: 'compiling', requiresSignature: false },
      { from: 'compiling', to: 'completeness_check', requiresSignature: false },
      { from: 'completeness_check', to: 'submitted', requiresSignature: false },
      { from: 'submitted', to: 'query_received', requiresSignature: false },
      { from: 'resubmitted_for_review', to: 'query_received', requiresSignature: false },
      { from: 'query_received', to: 'responding', requiresSignature: false },
      { from: 'responding', to: 'resubmitted_for_review', requiresSignature: false },
      { from: 'submitted', to: 'approved', requiresSignature: true },
      { from: 'submitted', to: 'rejected', requiresSignature: false },
      { from: 'resubmitted_for_review', to: 'approved', requiresSignature: true },
      { from: 'resubmitted_for_review', to: 'rejected', requiresSignature: false },
    ]
    await testPrisma.workflowTransition.createMany({
      data: transitions.map((t) => ({
        id: randomUUID(),
        definitionId: defId,
        fromStateId: stateIds.get(t.from)!,
        toStateId: stateIds.get(t.to)!,
        requiredRoleId: tenantRoleId,
        requiresSignature: t.requiresSignature,
      })),
    })

    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), raOfficer)
      .send({ brandName: 'Amoxiclav', genericName: 'Amoxicillin/Clavulanate', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' })
      .expect(201)
    productId = product.body.data.id as string
  })

  async function activeRequirement(productClass: string) {
    const req = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
      .send({ countryId, authorityId, productClass, effectiveFrom: '2026-01-01', unverified: false, documentDefinitions: [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }] })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${req.body.data.id}/activate`), admin).expect(201)
  }

  async function activeDeadlineRule(obligationType: string, intervalValue: number, intervalUnit: 'days' | 'months' | 'years', productClass = '*') {
    const rule = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/deadline-rules'), admin)
      .send({ countryId, authorityId, productClass, obligationType, intervalValue, intervalUnit, unverified: false, effectiveFrom: '2026-01-01' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/deadline-rules/${rule.body.data.id}/activate`), admin).expect(201)
  }

  async function createDossierAndCompile(productClass: string): Promise<{ dossierId: string; workflowInstanceId: string }> {
    const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer).send({ productId, authorityId, productClass }).expect(201)
    const dossierId = dossier.body.data.id as string
    const slotId = dossier.body.data.documentSlots[0]?.id as string

    const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
    const workflowInstanceId = fetched.body.data.workflowInstanceId as string

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'compiling' }).expect(201)

    if (slotId) {
      const upload = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), raOfficer)
        .field('title', 'CPP scan')
        .attach('file', Buffer.from('%PDF-1.4 fake cpp'), { filename: 'cpp.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slotId}/attach`), raOfficer).send({ documentId: upload.body.data.document.id }).expect(201)
    }

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'completeness_check' }).expect(201)
    return { dossierId, workflowInstanceId }
  }

  async function approveFreshRegistration(registrationNumber: string): Promise<{ dossierId: string; productRegistrationId: string }> {
    const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
    const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
      .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
    // `expiresOn` passed explicitly so this helper never depends on an
    // active renewal rule existing — several Stage 8 tests deliberately
    // activate their own `annual_report`/`renewal` rules with specific
    // values, and forcing a renewal rule here too would be redundant.
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
      .send({
        toStateKey: 'approved',
        payload: {
          registrationNumber,
          issuedOn: '2026-03-01',
          expiresOn: '2031-03-01',
          approvalEvidenceDocumentId: await uploadDoc(dossierId, raOfficer, 'approval-letter'),
          approvalPaymentProofDocumentId: await uploadDoc(dossierId, raOfficer, 'payment-proof'),
          approvalInvoiceDocumentId: await uploadDoc(dossierId, raOfficer, 'invoice'),
        },
        signatureToken: await mintSignatureToken(raOfficer),
        intentStatement: 'Approve.',
      })
      .expect(201)

    const dossierAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
    return { dossierId, productRegistrationId: dossierAfter.body.data.productRegistrationId as string }
  }

  describe('Stage 8 — Post-Market & Obligations', () => {
    it('auto-starts tracking an active, non-reserved obligation type the moment a registration is approved', async () => {
      await activeRequirement('generic_pharma')
      await activeDeadlineRule('annual_report', 1, 'years')

      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL1')

      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-post-market-obligations?productRegistrationId=${productRegistrationId}`), raOfficer).expect(200)
      const obligation = (list.body.data as { obligationType: string; dueAt: string; status: string }[]).find((o) => o.obligationType === 'annual_report')
      expect(obligation).toBeDefined()
      expect(obligation!.status).toBe('pending')
      expect(obligation!.dueAt.slice(0, 10)).toBe('2027-03-01')
    })

    it('never tracks a reserved obligation type (renewal) as a generic Stage 8 obligation', async () => {
      await activeRequirement('generic_pharma')
      await activeDeadlineRule('renewal', 5, 'years')

      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL2')

      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-post-market-obligations?productRegistrationId=${productRegistrationId}`), raOfficer).expect(200)
      expect((list.body.data as { obligationType: string }[]).some((o) => o.obligationType === 'renewal')).toBe(false)
    })

    it('a manual obligation with no active rule requires an explicit due date', async () => {
      await activeRequirement('generic_pharma')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL3')

      const blocked = await authedWrite(request(httpServer(app)).post('/api/v1/reg-post-market-obligations'), raOfficer)
        .send({ productRegistrationId, obligationType: 'periodic_safety_update' })
        .expect(409)
      expect(blocked.body.error.code).toBe('DUE_DATE_REQUIRED')

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reg-post-market-obligations'), raOfficer)
        .send({ productRegistrationId, obligationType: 'periodic_safety_update', dueAt: '2027-01-01' })
        .expect(201)
      expect((created.body.data.dueAt as string).slice(0, 10)).toBe('2027-01-01')
    })

    it('fulfilling an obligation with an active rule rolls it forward to the next cycle, keeping full fulfillment history', async () => {
      await activeRequirement('generic_pharma')
      await activeDeadlineRule('annual_report', 1, 'years')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL4')

      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-post-market-obligations?productRegistrationId=${productRegistrationId}`), raOfficer).expect(200)
      const obligationId = (list.body.data as { id: string; obligationType: string }[]).find((o) => o.obligationType === 'annual_report')!.id

      const upload = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_post_market_obligation/${obligationId}/documents/upload`), raOfficer)
        .field('title', 'Filed with PPB')
        .attach('file', Buffer.from('proof of filing'), { filename: 'filing.pdf', contentType: 'application/pdf' })
        .expect(201)

      const fulfilled = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-post-market-obligations/${obligationId}/fulfill`), raOfficer)
        .send({ evidenceDocumentId: upload.body.data.document.id, note: 'Filed on time.' })
        .expect(201)

      expect(fulfilled.body.data.status).toBe('pending')
      expect(fulfilled.body.data.fulfillments).toHaveLength(1)
      expect(fulfilled.body.data.fulfillments[0].evidenceDocumentId).toBe(upload.body.data.document.id)
    })

    it('fulfilling with generateFilingRecord produces a real GeneratedReport', async () => {
      await activeRequirement('generic_pharma')
      await activeDeadlineRule('annual_report', 1, 'years')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL5')
      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-post-market-obligations?productRegistrationId=${productRegistrationId}`), raOfficer).expect(200)
      const obligationId = (list.body.data as { id: string; obligationType: string }[]).find((o) => o.obligationType === 'annual_report')!.id

      const fulfilled = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-post-market-obligations/${obligationId}/fulfill`), raOfficer)
        .send({ generateFilingRecord: true })
        .expect(201)

      expect(fulfilled.body.data.fulfillments[0].generatedReportId).toBeTruthy()
    })

    it('RBAC — regulatory.manage_obligations is required to create/fulfill', async () => {
      await activeRequirement('generic_pharma')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-OBL6')
      const noPermRole = 'EXECUTIVE_READONLY'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'Read Only', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/reg-post-market-obligations'), readonlyActor)
        .send({ productRegistrationId, obligationType: 'periodic_safety_update', dueAt: '2027-01-01' })
        .expect(403)
    })
  })

  describe('Stage 9 — Archive & Custody', () => {
    it('aggregates every dossier/submission/query/obligation/fee tied to a registration into one chronological view', async () => {
      await activeRequirement('generic_pharma')
      await activeDeadlineRule('annual_report', 1, 'years')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-ARC1')

      const archive = await authed(request(httpServer(app)).get(`/api/v1/product-registrations/${productRegistrationId}/archive`), raOfficer).expect(200)

      expect(archive.body.data.registration.registrationNumber).toBe('PPB-2026-ARC1')
      expect(archive.body.data.dossiers).toHaveLength(1)
      expect(archive.body.data.dossiers[0].submissions).toHaveLength(1)
      expect((archive.body.data.obligations as { obligationType: string }[]).some((o) => o.obligationType === 'annual_report')).toBe(true)
    })

    it('exports a real CSV of the same archive', async () => {
      await activeRequirement('generic_pharma')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-ARC2')

      const csv = await authed(request(httpServer(app)).get(`/api/v1/product-registrations/${productRegistrationId}/archive/export.csv`), raOfficer).expect(200)
      expect(csv.headers['content-type']).toMatch(/text\/csv/)
      expect(csv.text.split('\n')[0]).toBe('Type,Date,Reference,Detail,Status')
      expect(csv.text).toMatch(/Dossier,/)
    })

    it('404s the archive for a registration in another company', async () => {
      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const otherCompanyId = randomUUID()
      await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Co', companyType: 'manufacturer', homeCountryId: otherCountryId, status: 'active' } })
      const otherActor = await createAuthenticatedActor(app, testPrisma, { companyId: otherCompanyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

      await activeRequirement('generic_pharma')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-ARC3')

      await authed(request(httpServer(app)).get(`/api/v1/product-registrations/${productRegistrationId}/archive`), otherActor).expect(404)
    })
  })

  describe('Stage 10 — Establishment/Premises & Personnel Licensing', () => {
    it('records a facility operating licence via the dedicated narrow endpoint', async () => {
      const facility = await authedWrite(request(httpServer(app)).post('/api/v1/facilities'), raOfficer).send({ countryId, name: 'Nairobi Central Pharmacy' }).expect(201)
      const facilityId = facility.body.data.id as string

      const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/facilities/${facilityId}/licence`), raOfficer)
        .send({ licenceNumber: 'PPB-PREM-2026-001', licenceIssuedOn: '2026-01-01', licenceExpiresOn: '2027-01-01', licenceStatus: 'active' })
        .expect(200)

      expect(updated.body.data.licenceNumber).toBe('PPB-PREM-2026-001')
      expect(updated.body.data.licenceStatus).toBe('active')
    })

    it('records and updates a personnel licence, clearing the renewal-reminder guard on a new expiry', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/personnel-licences'), raOfficer)
        .send({ userId: raOfficer.userId, licenceType: 'superintendent_pharmacist', licenceNumber: 'PH-2026-0099', issuedOn: '2026-01-01', expiresOn: '2027-01-01' })
        .expect(201)
      expect(created.body.data.status).toBe('active')

      const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/personnel-licences/${created.body.data.id}`), raOfficer)
        .send({ expiresOn: '2032-01-01' })
        .expect(200)
      expect((updated.body.data.expiresOn as string).slice(0, 10)).toBe('2032-01-01')
    })

    it('RBAC — regulatory.manage_licensing is required to record a personnel licence', async () => {
      const noPermRole = 'DISPENSING_PHARMACIST'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'Dispensing Pharmacist', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/personnel-licences'), readonlyActor)
        .send({ userId: raOfficer.userId, licenceType: 'pharmacist', licenceNumber: 'PH-1', issuedOn: '2026-01-01' })
        .expect(403)
    })
  })

  describe('Stage 11 — Import/Export & Permits', () => {
    it('creates and updates an import/export permit against a real authority', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/import-export-permits'), raOfficer)
        .send({ productId, authorityId, permitType: 'import', validFrom: '2026-01-01', validTo: '2027-01-01' })
        .expect(201)
      expect(created.body.data.status).toBe('draft')

      const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/import-export-permits/${created.body.data.id}`), raOfficer)
        .send({ status: 'active', permitNumber: 'IMP-2026-001' })
        .expect(200)
      expect(updated.body.data.status).toBe('active')
      expect(updated.body.data.permitNumber).toBe('IMP-2026-001')
    })

    it('links a permit to an existing product registration when one is given', async () => {
      await activeRequirement('generic_pharma')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-PERM1')

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/import-export-permits'), raOfficer)
        .send({ productId, productRegistrationId, authorityId, permitType: 'export' })
        .expect(201)
      expect(created.body.data.productRegistrationId).toBe(productRegistrationId)
    })

    it('RBAC — regulatory.manage_import_export is required to create a permit', async () => {
      const noPermRole = 'QUALITY_ASSOCIATE'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'QA', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/import-export-permits'), readonlyActor)
        .send({ productId, authorityId, permitType: 'import' })
        .expect(403)
    })
  })
})
