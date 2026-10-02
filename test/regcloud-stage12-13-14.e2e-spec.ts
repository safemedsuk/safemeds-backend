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
 * RegCloud (Phase 12) Stages 12–14 — Clinical Trials Regulatory Route
 * (reuse, not rebuild), Advertising & Promotion, and Post-Market & Recall
 * (cross-module). Real HTTP coverage against the running app.
 */
describe('RegCloud Stages 12–14 — Clinical Trial Route / Promotional Material / Recalls (e2e)', () => {
  let app: INestApplication
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
    await testPrisma.company.create({ data: { id: companyId, name: 'RegCloud Stage12-14 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

    const tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of [
      'regulatory.manage_dossier',
      'regulatory.view_all',
      'regulatory.submit',
      'regulatory.manage_promotional_material',
      'regulatory.manage_recalls',
      // QualCloud Stage 10.8's own RBAC correction — `Recall` creation/
      // linking now goes through `quality.log_recall`
      // (RECALL.CREATE/EDIT -> QUALITY_ASSOCIATE/QUALITY_MANAGER, also
      // preserved on this role); `regulatory.manage_recalls` above is
      // now scoped narrowly to the regulator-submission actions this
      // file doesn't exercise.
      'quality.log_recall',
      'regulatory.manage_import_export',
      'pv.manage_clinical_trials',
      'pv.view_all',
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

    // A minimal `reg_registration` workflow definition — `RegDossierService
    // .create()` unconditionally instantiates one on every dossier create
    // (Stage 12's own CTA dossiers go through this exact same mechanics),
    // even though this spec never needs to walk a dossier through its full
    // lifecycle the way `regcloud-stage8-9-10-11.e2e-spec.ts` does.
    const regDefId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: regDefId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    await testPrisma.workflowState.create({ data: { id: randomUUID(), definitionId: regDefId, stateKey: 'planning', name: 'Planning', isInitial: true, isTerminal: false } })

    // Stage 13's `promotional_material` workflow (4 states, 3 transitions).
    const pmDefId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: pmDefId, recordType: 'promotional_material', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const pmStateKeys = ['draft', 'submitted', 'approved', 'rejected']
    const pmStateIds = new Map<string, string>()
    await testPrisma.workflowState.createMany({
      data: pmStateKeys.map((key, idx) => ({
        id: (pmStateIds.set(key, randomUUID()), pmStateIds.get(key)!),
        definitionId: pmDefId,
        stateKey: key,
        name: key,
        isInitial: idx === 0,
        isTerminal: key === 'approved' || key === 'rejected',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId: pmDefId, fromStateId: pmStateIds.get('draft')!, toStateId: pmStateIds.get('submitted')!, requiredRoleId: tenantRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId: pmDefId, fromStateId: pmStateIds.get('submitted')!, toStateId: pmStateIds.get('approved')!, requiredRoleId: tenantRoleId, requiresSignature: true },
        { id: randomUUID(), definitionId: pmDefId, fromStateId: pmStateIds.get('submitted')!, toStateId: pmStateIds.get('rejected')!, requiredRoleId: tenantRoleId, requiresSignature: false },
      ],
    })

    // QualCloud (Phase 13) Stage 10.2's real 9-state `recall` workflow
    // (superseding the original 5-state `reported → investigating →
    // notified_to_authority → in_progress → closed` sequence this
    // fixture used to mirror) — `draft → under_assessment → approved →
    // notification → execution → reconciliation → closure_pending →
    // closed`, plus `draft/under_assessment → cancelled`.
    const recallDefId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: recallDefId, recordType: 'recall', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const recallStateKeys = [
      'draft',
      'under_assessment',
      'approved',
      'notification',
      'execution',
      'reconciliation',
      'closure_pending',
      'closed',
      'cancelled',
    ]
    const recallStateIds = new Map<string, string>()
    await testPrisma.workflowState.createMany({
      data: recallStateKeys.map((key, idx) => ({
        id: (recallStateIds.set(key, randomUUID()), recallStateIds.get(key)!),
        definitionId: recallDefId,
        stateKey: key,
        name: key,
        isInitial: idx === 0,
        isTerminal: key === 'closed' || key === 'cancelled',
      })),
    })
    const recallTransitions: { from: string; to: string; requiresSignature: boolean }[] = [
      { from: 'draft', to: 'under_assessment', requiresSignature: false },
      { from: 'draft', to: 'cancelled', requiresSignature: false },
      { from: 'under_assessment', to: 'cancelled', requiresSignature: false },
      { from: 'under_assessment', to: 'approved', requiresSignature: true },
      { from: 'approved', to: 'notification', requiresSignature: false },
      { from: 'notification', to: 'execution', requiresSignature: false },
      { from: 'execution', to: 'reconciliation', requiresSignature: false },
      { from: 'reconciliation', to: 'closure_pending', requiresSignature: false },
      { from: 'closure_pending', to: 'execution', requiresSignature: false },
      { from: 'closure_pending', to: 'closed', requiresSignature: true },
    ]
    await testPrisma.workflowTransition.createMany({
      data: recallTransitions.map((t) => ({
        id: randomUUID(),
        definitionId: recallDefId,
        fromStateId: recallStateIds.get(t.from)!,
        toStateId: recallStateIds.get(t.to)!,
        requiredRoleId: tenantRoleId,
        requiresSignature: t.requiresSignature,
      })),
    })

    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), raOfficer)
      .send({ brandName: 'Amoxiclav', genericName: 'Amoxicillin/Clavulanate', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' })
      .expect(201)
    productId = product.body.data.id as string
  })

  async function mintSignatureToken(actor: TestActor): Promise<string> {
    const { SignatureTokenService } = await import('../src/modules/auth/services/signature-token.service')
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  describe('Stage 12 — Clinical Trials Regulatory Route (reuse, not rebuild)', () => {
    /** Real-usage request, 22 Sep 2026 (items 19/20) — `POST /pv/clinical-trials` now requires both approval documents. */
    async function createTrial(): Promise<string> {
      const regulatoryApprovalDocumentId = randomUUID()
      const ethicsApprovalDocumentId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.document.create({ data: { id: regulatoryApprovalDocumentId, companyId, recordType: 'clinical_trial', recordId: companyId, title: 'Regulatory approval', createdBy: raOfficer.userId } })
        await tx.document.create({ data: { id: ethicsApprovalDocumentId, companyId, recordType: 'clinical_trial', recordId: companyId, title: 'Ethics approval', createdBy: raOfficer.userId } })
      })
      const trial = await authedWrite(request(httpServer(app)).post('/api/v1/pv/clinical-trials'), raOfficer)
        .send({
          trialReference: `NCT-STG12-${randomUUID().slice(0, 8)}`,
          trialName: 'A Study of Amoxiclav',
          countryId,
          startDate: '2025-01-01',
          regulatoryApprovalDocumentId,
          regulatoryApprovalDate: '2025-01-01',
          ethicsApprovalDocumentId,
          ethicsApprovalDate: '2025-01-01',
        })
        .expect(201)
      return trial.body.data.id as string
    }

    it('creates a Clinical Trial Application dossier linked to a real trial, through the exact same reg_dossier mechanics as any other dossier', async () => {
      const trialId = await createTrial()

      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'clinical_trial_imp', clinicalTrialId: trialId })
        .expect(201)

      expect(dossier.body.data.clinicalTrialId).toBe(trialId)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossier.body.data.id}`), raOfficer).expect(200)
      expect(fetched.body.data.workflowInstanceId).toBeTruthy()
    })

    it('lists only the dossiers filed for one specific trial', async () => {
      const trialId = await createTrial()
      const otherTrialId = await createTrial()

      await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer).send({ productId, authorityId, productClass: 'clinical_trial_imp', clinicalTrialId: trialId }).expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'clinical_trial_imp', clinicalTrialId: otherTrialId })
        .expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer).send({ productId, authorityId, productClass: 'generic_pharma' }).expect(201)

      const list = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers?clinicalTrialId=${trialId}`), raOfficer).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].clinicalTrialId).toBe(trialId)
    })

    it('404s when the given clinicalTrialId does not resolve for this company', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'clinical_trial_imp', clinicalTrialId: randomUUID() })
        .expect(404)
    })

    it('creates an IMP import/export permit linked to a trial', async () => {
      const trialId = await createTrial()

      const permit = await authedWrite(request(httpServer(app)).post('/api/v1/import-export-permits'), raOfficer)
        .send({ productId, authorityId, permitType: 'import', clinicalTrialId: trialId })
        .expect(201)

      expect(permit.body.data.clinicalTrialId).toBe(trialId)

      const list = await authed(request(httpServer(app)).get(`/api/v1/import-export-permits?clinicalTrialId=${trialId}`), raOfficer).expect(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0].id).toBe(permit.body.data.id)
    })

    it('404s when the given clinicalTrialId does not resolve for the permit', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/import-export-permits'), raOfficer)
        .send({ productId, authorityId, permitType: 'import', clinicalTrialId: randomUUID() })
        .expect(404)
    })
  })

  describe('Stage 13 — Advertising & Promotion', () => {
    it('walks a promotional material submission from draft through the completeness gate to a signed approval', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/promotional-material-submissions'), raOfficer)
        .send({ productId, authorityId, materialType: 'print' })
        .expect(201)
      const submissionId = created.body.data.id as string
      const workflowInstanceId = created.body.data.workflowInstanceId as string
      expect(created.body.data.status).toBe('draft')

      // Blocked — no material document attached yet.
      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/attach the promotional material/i)

      const upload = await authedWrite(request(httpServer(app)).post(`/api/v1/records/promotional_material/${submissionId}/documents/upload`), raOfficer)
        .field('title', 'Print advert v1')
        .attach('file', Buffer.from('%PDF-1.4 fake advert'), { filename: 'advert.pdf', contentType: 'application/pdf' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/promotional-material-submissions/${submissionId}/material-document`), raOfficer)
        .send({ documentId: upload.body.data.document.id })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      const approved = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Approve this advert.' })
        .expect(201)
      expect(approved.body.data.currentStateId).toBeTruthy()

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/promotional-material-submissions/${submissionId}`), raOfficer).expect(200)
      expect(fetched.body.data.status).toBe('approved')
      expect(fetched.body.data.transitionHistory).toHaveLength(2)
    })

    it('can be created with the material document attached up front, skipping the separate attach step', async () => {
      const upload = await authedWrite(request(httpServer(app)).post(`/api/v1/records/promotional_material/${randomUUID()}/documents/upload`), raOfficer)
        .field('title', 'Digital banner')
        .attach('file', Buffer.from('%PDF-1.4 banner'), { filename: 'banner.pdf', contentType: 'application/pdf' })
        .expect(201)

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/promotional-material-submissions'), raOfficer)
        .send({ productId, authorityId, materialType: 'digital', materialDocumentId: upload.body.data.document.id })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${created.body.data.workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(201)
    })

    it('a submitted material can be rejected without a signature', async () => {
      const upload = await authedWrite(request(httpServer(app)).post(`/api/v1/records/promotional_material/${randomUUID()}/documents/upload`), raOfficer)
        .field('title', 'Broadcast script')
        .attach('file', Buffer.from('%PDF-1.4 script'), { filename: 'script.pdf', contentType: 'application/pdf' })
        .expect(201)
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/promotional-material-submissions'), raOfficer)
        .send({ productId, authorityId, materialType: 'broadcast', materialDocumentId: upload.body.data.document.id })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${created.body.data.workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${created.body.data.workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'rejected' })
        .expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/promotional-material-submissions/${created.body.data.id}`), raOfficer).expect(200)
      expect(fetched.body.data.status).toBe('rejected')
    })

    it('404s when the product does not belong to this company', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/promotional-material-submissions'), raOfficer)
        .send({ productId: randomUUID(), authorityId, materialType: 'print' })
        .expect(404)
    })

    it('RBAC — regulatory.manage_promotional_material is required to create a submission', async () => {
      const noPermRole = 'EXECUTIVE_READONLY'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'Read Only', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/promotional-material-submissions'), readonlyActor)
        .send({ productId, authorityId, materialType: 'print' })
        .expect(403)
    })
  })

  describe('Stage 14 — Post-Market & Recall (cross-module)', () => {
    async function createFixtureCase(): Promise<string> {
      const reportTypeId = randomUUID()
      const caseId = randomUUID()
      return testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.reportType.create({ data: { id: reportTypeId, typeKey: `adr_${caseId.slice(0, 8)}`, name: 'Suspected ADR' } })
        await tx.case.create({
          data: {
            id: caseId,
            companyId,
            referenceNumber: `CASE-${caseId.slice(0, 8)}`,
            reportTypeId,
            countryOfOccurrenceId: countryId,
            countryOfReportId: countryId,
            awarenessDate: new Date('2026-08-01'),
            receivedDate: new Date('2026-08-01'),
          },
        })
        return caseId
      })
    }

    it('walks a recall through the real QualCloud Stage 10.2 lifecycle to a signed Closed, blocked on approval until scope+risk exist', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer)
        .send({ productId, reason: 'Contamination detected in batch 2026-04', recallClass: 'Class II' })
        .expect(201)
      const recallId = created.body.data.id as string
      const workflowInstanceId = created.body.data.workflowInstanceId as string
      expect(created.body.data.status).toBe('draft')
      expect(created.body.data.mode).toBe('real')
      expect(created.body.data.ref).toMatch(/^REC-\d{4}-\d{4}$/)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'under_assessment' })
        .expect(201)

      // Blocked — no frozen scope version and no risk assessment yet
      // (`RecallWorkflowGuards`'s real approval gate).
      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Approve this recall.' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/freeze a product\/batch scope/i)

      const batchId = randomUUID()
      const scopeVersionId = randomUUID()
      const riskAssessmentId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.batch.create({
          data: { id: batchId, companyId, productId, batchNumber: 'B2026-04', manufacturedOn: new Date('2026-04-01'), expiresOn: new Date('2028-04-01') },
        })
        await tx.recallScopeVersion.create({
          data: { id: scopeVersionId, companyId, recallId, version: 1, status: 'frozen', approvedBy: raOfficer.userId, approvedAt: new Date() },
        })
        await tx.recallScopeItem.create({ data: { id: randomUUID(), scopeVersionId, productId, batchId, batchSize: 10_000 } })
        await tx.riskAssessment.create({
          data: { id: riskAssessmentId, companyId, sourceRecordType: 'recall', sourceRecordId: recallId, title: 'Contamination risk', severity: 4, probability: 3, score: 12, riskLevel: 'high', createdBy: raOfficer.userId },
        })
      })

      // Still blocked with no risk-assessment-only fixture removed —
      // now both prerequisites are on record, so approval succeeds.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Approve this recall.' })
        .expect(201)

      const approved = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recallId}`), raOfficer).expect(200)
      expect(approved.body.data.status).toBe('approved')

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'notification' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'execution' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'reconciliation' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'closure_pending' }).expect(201)

      // Stage 10.6's own real 8-gate closure check — with no country
      // added at all, gate 8 alone would block closure regardless of
      // anything else; satisfy it (and gate 6, the linked
      // recall-investigation CAPA) directly, the same
      // bypass_rls-fixture-row pattern this file already uses above.
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.recallCountry.create({
          data: { id: randomUUID(), companyId, recallId, countryId, status: 'closure_submitted' },
        })
        await tx.capa.create({
          data: {
            id: randomUUID(),
            companyId,
            sourceRecordType: 'recall_investigation',
            sourceRecordId: recallId,
            title: 'Root cause of contamination',
            correctiveAction: 'Retrain line staff',
          },
        })
      })

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'closed', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Close this recall — corrective action complete.' })
        .expect(201)

      const closed = await authed(request(httpServer(app)).get(`/api/v1/recalls/${recallId}`), raOfficer).expect(200)
      expect(closed.body.data.status).toBe('closed')
      expect(closed.body.data.closedAt).toBeTruthy()
      expect(closed.body.data.transitionHistory).toHaveLength(7)
    })

    it('requires a real reason to cancel a recall from draft', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer)
        .send({ productId, reason: 'False alarm under investigation' })
        .expect(201)
      const workflowInstanceId = created.body.data.workflowInstanceId as string

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'cancelled' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/reason is required to cancel/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'cancelled', note: 'Confirmed false alarm — no genuine defect found.' })
        .expect(201)
    })

    it('links a real PV case to a recall as evidence, via a plain FK/lookup link, at creation time and afterward', async () => {
      const caseId = await createFixtureCase()
      const secondCaseId = await createFixtureCase()

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer)
        .send({ productId, reason: 'Adverse events reported for this batch', caseIds: [caseId] })
        .expect(201)
      expect(created.body.data.linkedCases).toHaveLength(1)
      expect(created.body.data.linkedCases[0].id).toBe(caseId)

      const linked = await authedWrite(request(httpServer(app)).post(`/api/v1/recalls/${created.body.data.id}/link-cases`), raOfficer)
        .send({ caseIds: [secondCaseId, caseId] })
        .expect(201)
      // The already-linked case is not double-linked; only the new one adds a row.
      expect(linked.body.data.linkedCases).toHaveLength(2)
    })

    it('links to an existing QualCloud CAPA as the root cause, when one already exists', async () => {
      const capaId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.capa.create({ data: { id: capaId, companyId, title: 'Root cause CAPA', correctiveAction: 'Retrain line staff' } })
      })

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer)
        .send({ productId, reason: 'Root-caused to a training gap', rootCauseCapaId: capaId })
        .expect(201)

      expect(created.body.data.rootCauseCapaId).toBe(capaId)
    })

    it('404s when the given rootCauseCapaId does not belong to this company', async () => {
      const otherCompanyId = randomUUID()
      await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
      const otherCapaId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.capa.create({ data: { id: otherCapaId, companyId: otherCompanyId, title: 'Not yours', correctiveAction: 'n/a' } })
      })

      await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer).send({ productId, reason: 'x', rootCauseCapaId: otherCapaId }).expect(404)
    })

    it('blocks Closed until the real 8-gate closure check passes (Stage 10.6), naming every failed gate, then succeeds once every gate clears', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer).send({ productId, reason: 'Contamination' }).expect(201)
      const recallId = created.body.data.id as string
      const workflowInstanceId = created.body.data.workflowInstanceId as string

      const batchId = randomUUID()
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.batch.create({
          data: { id: batchId, companyId, productId, batchNumber: 'B2026-05', manufacturedOn: new Date('2026-05-01'), expiresOn: new Date('2028-05-01') },
        })
        const scopeVersionId = randomUUID()
        await tx.recallScopeVersion.create({
          data: { id: scopeVersionId, companyId, recallId, version: 1, status: 'frozen', approvedBy: raOfficer.userId, approvedAt: new Date() },
        })
        await tx.recallScopeItem.create({ data: { id: randomUUID(), scopeVersionId, productId, batchId, batchSize: 500 } })
        await tx.riskAssessment.create({
          data: { id: randomUUID(), companyId, sourceRecordType: 'recall', sourceRecordId: recallId, title: 'Contamination risk', severity: 3, probability: 3, score: 9, riskLevel: 'medium', createdBy: raOfficer.userId },
        })
      })

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'under_assessment' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'approved', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Approve.' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'notification' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'execution' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'reconciliation' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'closure_pending' })
        .expect(201)

      // Blocked — no country has reached closure_submitted (Gate 8) and
      // no recall-investigation CAPA is linked (Gate 6). Every failed
      // gate is named explicitly, never a bare "cannot close."
      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'closed', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Close.' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/Gate 8 \(Closure recorded with every country\)/)
      expect(blocked.body.error.message).toMatch(/Gate 6 \(A recall-investigation CAPA is linked\)/)

      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.recallCountry.create({
          data: { id: randomUUID(), companyId, recallId, countryId, status: 'closure_submitted' },
        })
        await tx.capa.create({
          data: {
            id: randomUUID(),
            companyId,
            sourceRecordType: 'recall_investigation',
            sourceRecordId: recallId,
            title: 'Root cause',
            correctiveAction: 'Fix it',
          },
        })
      })

      // Every gate clears — the recall's own reason (set at creation
      // and never clearable through this API) plays no direct role in
      // this check anymore, unlike the old, now-superseded backstop.
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'closed', signatureToken: await mintSignatureToken(raOfficer), intentStatement: 'Close.' })
        .expect(201)
    })

    it('404s when the product does not belong to this company', async () => {
      await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer).send({ productId: randomUUID(), reason: 'x' }).expect(404)
    })

    it('RBAC — a real permission is required to create a recall', async () => {
      const noPermRole = 'EXECUTIVE_READONLY'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'Read Only', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), readonlyActor).send({ productId, reason: 'x' }).expect(403)
    })

    it('404s a recall belonging to another company (invisible under RLS)', async () => {
      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const otherCompanyId = randomUUID()
      await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Co 2', companyType: 'manufacturer', homeCountryId: otherCountryId, status: 'active' } })
      const otherActor = await createAuthenticatedActor(app, testPrisma, { companyId: otherCompanyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/recalls'), raOfficer).send({ productId, reason: 'x' }).expect(201)

      await authed(request(httpServer(app)).get(`/api/v1/recalls/${created.body.data.id}`), otherActor).expect(404)
    })
  })
})
