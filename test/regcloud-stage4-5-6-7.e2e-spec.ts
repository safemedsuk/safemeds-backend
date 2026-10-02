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
 * RegCloud (Phase 12) Stages 4–7 — Submit, Query & Assessment,
 * Approval/Registration, and Lifecycle: Variations & Renewals, exercised
 * end-to-end against the real running app and the *complete* real
 * `reg_registration` workflow (planning → … → approved/rejected — all
 * 9 states, all 11 transitions, matching `prisma/workflow.seed-data.ts`
 * exactly, not the smaller 3-state fixture `regcloud-stage1-2-3.e2e-spec.ts`
 * only ever needed for its own narrower scope).
 */
describe('RegCloud Stages 4–7 — Submit / Query & Assessment / Approval / Variations (e2e)', () => {
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

  /** Mints a real, single-use re-auth signature token via the app's own signing path — the same technique `workflow.e2e-spec.ts` already established, since an arbitrary string never passes real signature verification. */
  async function mintSignatureToken(actor: TestActor): Promise<string> {
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  /** testing-correction-explanation.md §2.4 — `requireApprovalData` now always needs a real `approvalEvidenceDocumentId` (and, for a fresh registration, a payment-proof/invoice pair too) before `→ approved` unlocks. */
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
    await testPrisma.company.create({ data: { id: companyId, name: 'RegCloud Stage4-7 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

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
      'master_data.manage',
      'master_data.view',
      'documents.manage',
    ]) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // The complete real reg_registration workflow — 9 states, 11 transitions.
    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    // testing-correction-explanation.md §2.2/§3.1 — `variation_application`/`renewal_requested` are the two new fast-forward entry points a variation/renewal dossier lands at, never reached via a seeded transition (only via `RegVariationService.create()`'s own direct `WorkflowInstance` override), matching `prisma/workflow.seed-data.ts`'s own real 9-state definition.
    const stateKeys = ['planning', 'compiling', 'completeness_check', 'variation_application', 'renewal_requested', 'submitted', 'query_received', 'responding', 'resubmitted_for_review', 'approved', 'rejected']
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
      { from: 'variation_application', to: 'submitted', requiresSignature: false },
      { from: 'renewal_requested', to: 'submitted', requiresSignature: false },
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
      .send({
        countryId,
        authorityId,
        productClass,
        effectiveFrom: '2026-01-01',
        unverified: false,
        documentDefinitions: [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }],
      })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${req.body.data.id}/activate`), admin).expect(201)
  }

  async function activeRenewalRule(productClass = '*') {
    const rule = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/deadline-rules'), admin)
      .send({ countryId, authorityId, productClass, obligationType: 'renewal', intervalValue: 5, intervalUnit: 'years', unverified: false, effectiveFrom: '2026-01-01' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/deadline-rules/${rule.body.data.id}/activate`), admin).expect(201)
  }

  async function createDossierAndCompile(productClass: string): Promise<{ dossierId: string; workflowInstanceId: string; slotId: string }> {
    const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
      .send({ productId, authorityId, productClass })
      .expect(201)
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

    return { dossierId, workflowInstanceId, slotId }
  }

  async function generateAndDispatch(dossierId: string): Promise<void> {
    const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
    const submissionId = submission.body.data.id as string
    await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submissionId}/evidence`), raOfficer)
      .attach('file', Buffer.from('proof of dispatch'), { filename: 'proof.pdf', contentType: 'application/pdf' })
      .expect(201)
  }

  describe('Stage 4 — Submit', () => {
    it('blocks Completeness Check → Submitted until a submission is generated and evidenced, then allows it', async () => {
      await activeRequirement('generic_pharma')
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/no submission package/i)

      const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
      expect(submission.body.data.submissionNumber).toBe(1)
      expect(submission.body.data.channel).toBe('paper_pdf')

      const stillBlocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(409)
      expect(stillBlocked.body.error.message).toMatch(/no dispatch evidence/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
        .attach('file', Buffer.from('proof of dispatch'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      const finalState = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(finalState.body.data.status).toBe('submitted')
    })
  })

  describe('Stage 6 — Approval creates a real registration', () => {
    it('approves a registration straight from Submitted (no query round) with a real signature, computing expiresOn from the active 5-year renewal rule', async () => {
      await activeRequirement('generic_pharma')
      await activeRenewalRule()
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      await generateAndDispatch(dossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', payload: {} })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/approval.*succeeded|approval letter/i)

      const evidenceDocumentId = await uploadDoc(dossierId, raOfficer, 'approval-letter')
      const paymentProofDocumentId = await uploadDoc(dossierId, raOfficer, 'payment-proof')
      const invoiceDocumentId = await uploadDoc(dossierId, raOfficer, 'invoice')

      const missingRegNumber = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', payload: { approvalEvidenceDocumentId: evidenceDocumentId, approvalPaymentProofDocumentId: paymentProofDocumentId, approvalInvoiceDocumentId: invoiceDocumentId } })
        .expect(409)
      expect(missingRegNumber.body.error.message).toMatch(/registration number/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: {
            registrationNumber: 'PPB-2026-0001',
            issuedOn: '2026-03-01',
            approvalEvidenceDocumentId: evidenceDocumentId,
            approvalPaymentProofDocumentId: paymentProofDocumentId,
            approvalInvoiceDocumentId: invoiceDocumentId,
          },
        })
        .expect(403) // signature required

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: {
            registrationNumber: 'PPB-2026-0001',
            issuedOn: '2026-03-01',
            approvalEvidenceDocumentId: evidenceDocumentId,
            approvalPaymentProofDocumentId: paymentProofDocumentId,
            approvalInvoiceDocumentId: invoiceDocumentId,
          },
          signatureToken: await mintSignatureToken(raOfficer),
          intentStatement: 'I approve this registration.',
        })
        .expect(201)

      const registrations = await authed(request(httpServer(app)).get('/api/v1/registrations'), raOfficer).expect(200)
      const created = (registrations.body.data as { registrationNumber: string; issuedOn: string; expiresOn: string }[]).find((r) => r.registrationNumber === 'PPB-2026-0001')
      expect(created).toBeDefined()
      expect(created!.expiresOn.slice(0, 10)).toBe('2031-03-01')

      const dossierAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(dossierAfter.body.data.status).toBe('approved')
      expect(dossierAfter.body.data.productRegistrationId).toBeTruthy()
    })

    it('rejects a dossier straight from Submitted, with no signature and no registration created', async () => {
      await activeRequirement('generic_pharma')
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      await generateAndDispatch(dossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'rejected', note: 'Missing GMP certificate.' })
        .expect(201)

      const dossierAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(dossierAfter.body.data.status).toBe('rejected')
      expect(dossierAfter.body.data.productRegistrationId).toBeNull()
    })
  })

  describe('Stage 5 — Query & Assessment, then approval after a full round trip', () => {
    it('walks submitted → query_received → responding → resubmitted_for_review → approved, and the correspondence log reflects it all', async () => {
      await activeRequirement('generic_pharma')
      await activeRenewalRule()
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      await generateAndDispatch(dossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      // Can't move to query_received until the query's own content is logged.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'query_received' }).expect(409)

      // testing-correction-explanation.md §2.1 — the regulator's own query letter, and a real note+date on response, are both now mandatory.
      const query = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries`), raOfficer)
        .field('queryText', 'Please clarify the CPP validity period.')
        .field('receivedDate', '2026-04-01')
        .attach('file', Buffer.from('query letter'), { filename: 'query.pdf', contentType: 'application/pdf' })
        .expect(201)
      expect(query.body.data.queryText).toBe('Please clarify the CPP validity period.')
      const queryId = query.body.data.id as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'query_received' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'responding' }).expect(201)

      // Can't resubmit until the query has a real response attached.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'resubmitted_for_review' }).expect(409)

      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${queryId}/respond`), raOfficer)
        .field('note', 'CPP validity period confirmed as 24 months from date of issue.')
        .field('respondedDate', '2026-04-10')
        .attach('file', Buffer.from('our response'), { filename: 'response.pdf', contentType: 'application/pdf' })
        .expect(201)

      // Responding twice is refused.
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${queryId}/respond`), raOfficer)
        .field('note', 'Already answered.')
        .field('respondedDate', '2026-04-11')
        .attach('file', Buffer.from('again'), { filename: 'response2.pdf', contentType: 'application/pdf' })
        .expect(409)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'resubmitted_for_review' }).expect(201)

      const evidenceDocumentId = await uploadDoc(dossierId, raOfficer, 'approval-letter')
      const paymentProofDocumentId = await uploadDoc(dossierId, raOfficer, 'payment-proof')
      const invoiceDocumentId = await uploadDoc(dossierId, raOfficer, 'invoice')
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: {
            registrationNumber: 'PPB-2026-0002',
            approvalEvidenceDocumentId: evidenceDocumentId,
            approvalPaymentProofDocumentId: paymentProofDocumentId,
            approvalInvoiceDocumentId: invoiceDocumentId,
          },
          signatureToken: await mintSignatureToken(raOfficer),
          intentStatement: 'Approved after query resolution.',
        })
        .expect(201)

      const dossierAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(dossierAfter.body.data.status).toBe('approved')
      // Decision History reflects the full round trip, newest first.
      const historyStates = (dossierAfter.body.data.transitionHistory as { toStateKey: string }[]).map((h) => h.toStateKey)
      expect(historyStates).toEqual([
        'approved',
        'resubmitted_for_review',
        'responding',
        'query_received',
        'submitted',
        'completeness_check',
        'compiling',
      ])
    })
  })

  describe('Stage 7 — Lifecycle: Variations & Renewals', () => {
    it('a renewal variation extends the existing registration\'s expiry using the exact same dossier/submission machinery, without creating a duplicate registration', async () => {
      await activeRequirement('generic_pharma')
      await activeRenewalRule()

      // First, get a real, approved registration through the normal Stage 1-6 flow.
      const { dossierId: initialDossierId, workflowInstanceId: initialInstanceId } = await createDossierAndCompile('generic_pharma')
      await generateAndDispatch(initialDossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${initialInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${initialInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: {
            registrationNumber: 'PPB-2026-0003',
            issuedOn: '2026-03-01',
            approvalEvidenceDocumentId: await uploadDoc(initialDossierId, raOfficer, 'approval-letter'),
            approvalPaymentProofDocumentId: await uploadDoc(initialDossierId, raOfficer, 'payment-proof'),
            approvalInvoiceDocumentId: await uploadDoc(initialDossierId, raOfficer, 'invoice'),
          },
          signatureToken: await mintSignatureToken(raOfficer),
          intentStatement: 'Approved.',
        })
        .expect(201)

      const registrations = await authed(request(httpServer(app)).get('/api/v1/registrations'), raOfficer).expect(200)
      const registration = (registrations.body.data as { id: string; registrationNumber: string; expiresOn: string }[]).find((r) => r.registrationNumber === 'PPB-2026-0003')!
      expect(registration.expiresOn.slice(0, 10)).toBe('2031-03-01')

      // Now file a renewal variation against it.
      const variation = await authedWrite(request(httpServer(app)).post('/api/v1/reg-variations'), raOfficer)
        .send({ productRegistrationId: registration.id, variationType: 'renewal' })
        .expect(201)
      expect(variation.body.data.status).toBe('open')
      const renewalDossierId = variation.body.data.regDossier.id as string
      expect(variation.body.data.regDossier.productClass).toBe('generic_pharma')

      const fetchedRenewalDossier = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${renewalDossierId}`), raOfficer).expect(200)
      expect(fetchedRenewalDossier.body.data.variation).toMatchObject({ variationType: 'renewal', productRegistrationId: registration.id, productRegistrationNumber: 'PPB-2026-0003' })
      expect(fetchedRenewalDossier.body.data.status).toBe('renewal_requested')
      const renewalInstanceId = fetchedRenewalDossier.body.data.workflowInstanceId as string

      // testing-correction-explanation.md §3.1 — a renewal dossier is
      // fast-forwarded straight past Planning/Compiling/Completeness Check
      // to Renewal Requested; its only real action from here is Generate
      // Submission (Stage 4's own mechanism, reused as-is) then Submitted.
      await generateAndDispatch(renewalDossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${renewalInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      // Approving a renewal needs no registration number, payment proof, or invoice at all (it already has one) — only the approval evidence itself.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${renewalInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: { approvalEvidenceDocumentId: await uploadDoc(renewalDossierId, raOfficer, 'renewal-approval-letter') },
          signatureToken: await mintSignatureToken(raOfficer),
          intentStatement: 'Renewal approved.',
        })
        .expect(201)

      const registrationsAfter = await authed(request(httpServer(app)).get('/api/v1/registrations'), raOfficer).expect(200)
      const rows = registrationsAfter.body.data as { id: string; registrationNumber: string; expiresOn: string }[]
      // Exactly one registration with this number — never duplicated.
      expect(rows.filter((r) => r.registrationNumber === 'PPB-2026-0003')).toHaveLength(1)
      const renewed = rows.find((r) => r.registrationNumber === 'PPB-2026-0003')!
      expect(renewed.expiresOn.slice(0, 10)).toBe('2036-03-01')

      const variationAfter = await authed(request(httpServer(app)).get(`/api/v1/reg-variations/${variation.body.data.id}`), raOfficer).expect(200)
      expect(variationAfter.body.data.status).toBe('approved')
      expect(variationAfter.body.data.approvedAt).toBeTruthy()
    })

    it('list() scopes variations to the given registration', async () => {
      await activeRequirement('generic_pharma')
      const { dossierId: initialDossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      await generateAndDispatch(initialDossierId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({
          toStateKey: 'approved',
          payload: {
            registrationNumber: 'PPB-2026-0004',
            issuedOn: '2026-01-01',
            expiresOn: '2031-01-01',
            approvalEvidenceDocumentId: await uploadDoc(initialDossierId, raOfficer, 'approval-letter'),
            approvalPaymentProofDocumentId: await uploadDoc(initialDossierId, raOfficer, 'payment-proof'),
            approvalInvoiceDocumentId: await uploadDoc(initialDossierId, raOfficer, 'invoice'),
          },
          signatureToken: await mintSignatureToken(raOfficer),
          intentStatement: 'Approved.',
        })
        .expect(201)
      const registrations = await authed(request(httpServer(app)).get('/api/v1/registrations'), raOfficer).expect(200)
      const registration = (registrations.body.data as { id: string; registrationNumber: string }[]).find((r) => r.registrationNumber === 'PPB-2026-0004')!

      // testing-correction-explanation.md §2.2 — `variationType` moved to the real, confirmed 4-category enum (`labeling_change` was the old free-text placeholder value).
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-variations'), raOfficer).send({ productRegistrationId: registration.id, variationType: 'minor' }).expect(201)

      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-variations?productRegistrationId=${registration.id}`), raOfficer).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].variationType).toBe('minor')
    })
  })

  describe('RBAC — regulatory.submit is required to generate/dispatch a submission', () => {
    it('a role without regulatory.submit cannot generate a submission package', async () => {
      await activeRequirement('generic_pharma')
      const { dossierId } = await createDossierAndCompile('generic_pharma')

      // No permissions granted at all — `RegSubmissionController.generate()`'s
      // own `@RequirePermissions('regulatory.submit')` overrides the
      // class-level `regulatory.view_all` gate entirely (`getAllAndOverride`),
      // so this alone is enough to prove the method-level gate holds.
      const readonlyRoleId = randomUUID()
      await testPrisma.role.create({ data: { id: readonlyRoleId, key: 'EXECUTIVE_READONLY', name: 'Executive Readonly', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })

      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), readonlyActor).expect(403)
    })
  })
})
