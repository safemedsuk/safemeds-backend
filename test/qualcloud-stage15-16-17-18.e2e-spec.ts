import { INestApplication } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { SignatureTokenService } from '../src/modules/auth/services/signature-token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/** `deviation`/`falsified_product_report`/etc. all carry `FORCE ROW LEVEL SECURITY` — see CLAUDE.md's own documented gotcha. Same bypass technique every other stage's e2e spec already establishes. */
function withBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx)
  })
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

async function seedRoleWithPermissions(
  roleId: string,
  roleKey: string,
  permissionKeys: string[],
): Promise<void> {
  await testPrisma.role.upsert({
    where: { id: roleId },
    update: {},
    create: { id: roleId, key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({
      where: { key },
      update: {},
      create: { id: randomUUID(), key, description: 'e2e fixture' },
    })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    })
  }
}

/**
 * QualCloud (Phase 13) Stages 15 (Pharmaceutical Waste Management), 16
 * (Falsified & Substandard Product Handling), 17 (Batch Release / QP),
 * and 18 (Validation / CSV) — walked end to end against the real
 * running app. This e2e database is truncated per test and never runs
 * the dev seed, so this file defines its own `quality_controlled_document`/
 * `quality_deviation`/`pv_case` workflow fixtures directly, matching
 * every other stage's own established per-file-fixture convention.
 *
 * Stage 17's `quality.manage_batch_release` permission is deliberately
 * granted to **no production role** (see `BatchReleaseService`'s own
 * doc comment) — this file grants it to its own dedicated `TEST_QP`
 * e2e-only role purely to exercise the mechanism, which is exactly the
 * real-world path (a platform operator grants it to a specific role via
 * the RBAC Admin Console) this feature expects in production.
 */
describe('QualCloud Stage 15/16/17/18 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let qaRoleId: string
  let qmRoleId: string
  let qpRoleId: string
  let productId: string
  let batchId: string
  let sopDefinitionId: string
  let sopStateIds: Record<string, string>

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function actorWith(roleKey: string): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  async function signatureTokenFor(actor: TestActor): Promise<string> {
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  beforeEach(async () => {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Stage 15-18 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    qaRoleId = randomUUID()
    qmRoleId = randomUUID()
    qpRoleId = randomUUID()
    await seedRoleWithPermissions(qaRoleId, 'QUALITY_ASSOCIATE', [
      'quality.view_all',
      'quality.manage_documents',
      'quality.manage_waste_disposal',
      'quality.manage_falsified_reports',
      'quality.log_deviation',
      'quality.review_batch_records',
      'master_data.view',
      'master_data.manage',
    ])
    await seedRoleWithPermissions(qmRoleId, 'QUALITY_MANAGER', [
      'quality.view_all',
      'quality.manage_documents',
      'quality.manage_validation',
      'quality.manage_waste_disposal',
      'quality.manage_falsified_reports',
      'quality.log_deviation',
      'quality.close_capa',
      'quality.review_batch_records',
      'signatures.read',
    ])
    // The real-world "a platform operator granted the senior QP gate to
    // this specific role" scenario — see this file's own doc comment.
    await seedRoleWithPermissions(qpRoleId, 'TEST_QP', [
      'quality.view_all',
      'quality.manage_batch_release',
    ])

    const setupActor = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_ASSOCIATE'],
    })

    const productRes = await authedWrite(request(httpServer(app)).post('/api/v1/products'), setupActor)
      .send({ brandName: 'Amoxil', genericName: 'Amoxicillin', productCategory: 'medicinal', dosageForm: 'Tablet', strength: '500mg' })
      .expect(201)
    productId = productRes.body.data.id as string

    const batchRes = await authedWrite(request(httpServer(app)).post('/api/v1/batches'), setupActor)
      .send({ productId, batchNumber: 'B2026-001', manufacturedOn: '2026-01-01', expiresOn: '2028-01-01' })
      .expect(201)
    batchId = batchRes.body.data.id as string

    // ── quality_deviation workflow fixture (needed by Stage 16's confirm()) ──
    const deviationDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: { id: deviationDefinitionId, recordType: 'quality_deviation', reportTypeId: null, countryId: null, version: 1, status: 'active' },
    })
    await testPrisma.workflowState.create({
      data: { id: randomUUID(), definitionId: deviationDefinitionId, stateKey: 'detected', name: 'Detected', isInitial: true, isTerminal: false },
    })

    // ── pv_case workflow fixture (needed only when Stage 16's confirm() routes to a PV case) ──
    await testPrisma.reportType.upsert({
      where: { typeKey: 'adr' },
      update: {},
      create: { id: randomUUID(), typeKey: 'adr', moduleKey: 'pv', name: 'Suspected ADR' },
    })
    const pvCaseDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: { id: pvCaseDefinitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' },
    })
    await testPrisma.workflowState.create({
      data: { id: randomUUID(), definitionId: pvCaseDefinitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: true },
    })

    // ── quality_controlled_document workflow fixture (needed by Stage 18) ──
    sopDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: { id: sopDefinitionId, recordType: 'quality_controlled_document', reportTypeId: null, countryId: null, version: 1, status: 'active' },
    })
    const sopStateKeys = ['draft', 'in_review', 'approved', 'effective', 'superseded', 'retired'] as const
    sopStateIds = {}
    for (const key of sopStateKeys) sopStateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: sopStateKeys.map((key) => ({
        id: sopStateIds[key],
        definitionId: sopDefinitionId,
        stateKey: key,
        name: key,
        isInitial: key === 'draft',
        isTerminal: key === 'superseded' || key === 'retired',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId: sopDefinitionId, fromStateId: sopStateIds.draft, toStateId: sopStateIds.in_review, requiredRoleId: qaRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId: sopDefinitionId, fromStateId: sopStateIds.in_review, toStateId: sopStateIds.approved, requiredRoleId: qmRoleId, requiresSignature: true },
        { id: randomUUID(), definitionId: sopDefinitionId, fromStateId: sopStateIds.approved, toStateId: sopStateIds.effective, requiredRoleId: qmRoleId, requiresSignature: false },
      ],
    })

    // `safemeds_test` stays schema-only per this project's own
    // established convention — it never runs `pnpm prisma:seed`, so
    // the real `waste_disposal_method_catalog_entry` catalog needs its
    // own minimal per-file fixture here, matching `reportType`'s own
    // upsert-in-`beforeEach` precedent above.
    await testPrisma.wasteDisposalMethodCatalogEntry.upsert({
      where: { methodKey: 'incineration' },
      update: {},
      create: { id: newId(), methodKey: 'incineration', label: 'Incineration', sortOrder: 1, active: true },
    })
  })

  describe('Stage 15 — Pharmaceutical Waste Management', () => {
    it('logs a disposal, lists the active method catalog, and records a witness signature', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')

      const methods = await authedWrite(request(httpServer(app)).get('/api/v1/quality/waste-disposal-methods'), qa).expect(200)
      expect(methods.body.data.length).toBeGreaterThan(0)

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/quality/waste-disposal'), qa)
        .send({
          batchId,
          wasteType: 'rejected_batch',
          quantity: '120',
          unit: 'tablets',
          disposalMethod: 'incineration',
          disposalFacilityName: 'EcoWaste Ltd',
          disposedAt: '2026-10-01T00:00:00.000Z',
        })
        .expect(201)
      expect(created.body.data.wasteType).toBe('rejected_batch')
      expect(created.body.data.witnessedByUserId).toBeNull()

      const witnessToken = await signatureTokenFor(qa)
      const witnessed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal/${created.body.data.id}/witness`),
        qa,
      )
        .send({ intentStatement: 'I witnessed this destruction', signatureToken: witnessToken })
        .expect(201)
      expect(witnessed.body.data.witnessedByUserId).toBe(qa.userId)

      // A second witness attempt is rejected.
      const secondToken = await signatureTokenFor(qa)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/waste-disposal/${created.body.data.id}/witness`),
        qa,
      )
        .send({ intentStatement: 'again', signatureToken: secondToken })
        .expect(409)
    })
  })

  describe('Stage 16 — Falsified & Substandard Product Handling', () => {
    it('reports, confirms (opening a real linked Deviation and a routed PV case), and closes a falsified product report', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/falsified-product-reports'),
        qa,
      )
        .send({
          productId,
          batchId,
          source: 'market_surveillance',
          evidenceDescription: 'Packaging holography does not match the authorized design',
        })
        .expect(201)
      expect(created.body.data.status).toBe('reported')

      const confirmed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/falsified-product-reports/${created.body.data.id}/confirm`),
        qa,
      )
        .send({ routeToPvCase: true, authorityNotified: true })
        .expect(201)
      expect(confirmed.body.data.status).toBe('confirmed')
      expect(confirmed.body.data.linkedDeviationId).toBeTruthy()
      expect(confirmed.body.data.linkedCaseId).toBeTruthy()
      expect(confirmed.body.data.authorityNotified).toBe(true)

      // The real linked Deviation exists, sourced correctly.
      const deviation = await withBypass((tx) =>
        tx.deviation.findUniqueOrThrow({ where: { id: confirmed.body.data.linkedDeviationId } }),
      )
      expect(deviation.sourceType).toBe('monitoring_alert')

      const closed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/falsified-product-reports/${created.body.data.id}/close`),
        qa,
      ).expect(201)
      expect(closed.body.data.status).toBe('closed')
    })

    it('dismisses an unsubstantiated report with a reason', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/falsified-product-reports'),
        qa,
      )
        .send({ source: 'complaint', evidenceDescription: 'A single unverifiable claim' })
        .expect(201)

      const dismissed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/falsified-product-reports/${created.body.data.id}/dismiss`),
        qa,
      )
        .send({ reason: 'Investigated — product confirmed genuine' })
        .expect(201)
      expect(dismissed.body.data.status).toBe('dismissed')

      // close() refuses once dismissed.
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/falsified-product-reports/${created.body.data.id}/close`),
        qa,
      ).expect(409)
    })
  })

  describe('Stage 17 — Batch Release (Qualified Person)', () => {
    async function setUpReviewedBatch(reviewer: TestActor): Promise<void> {
      const brrRes = await authedWrite(request(httpServer(app)).post('/api/v1/quality/batch-record-reviews'), reviewer)
        .send({ batchId })
        .expect(201)
      const reviewId = brrRes.body.data.id as string
      const dispositionToken = await signatureTokenFor(reviewer)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/batch-record-reviews/${reviewId}/disposition`),
        reviewer,
      )
        .send({ disposition: 'released', intentStatement: 'QA review complete', signatureToken: dispositionToken })
        .expect(201)
    }

    it('shows a failing readiness check, then blocks release until the open deviation is closed or risk-accepted, then succeeds', async () => {
      const qm = await actorWith('QUALITY_MANAGER')
      const qp = await actorWith('TEST_QP')

      const readinessBefore = await authedWrite(
        request(httpServer(app)).get(`/api/v1/quality/batches/${batchId}/release/readiness`),
        qp,
      ).expect(200)
      expect(readinessBefore.body.data.allPassed).toBe(false)
      const readinessItems = readinessBefore.body.data.items as { key: string; passed: boolean }[]
      expect(readinessItems.find((i) => i.key === 'batch_record_review')?.passed).toBe(false)

      await setUpReviewedBatch(qm)

      // A real open Deviation against this batch — e2e-created directly
      // (quality_deviation fixture above is minimal enough it doesn't
      // need a workflow transition to simply exist unclosed).
      const deviationId = randomUUID()
      await withBypass((tx) =>
        tx.deviation.create({
          data: {
            id: deviationId,
            companyId,
            deviationNumber: 'DEV-2026-TEST',
            title: 'Unrelated minor packaging deviation',
            sourceType: 'self_reported',
            batchId,
            detectedAt: new Date(),
            status: 'detected',
          },
        }),
      )

      const releaseToken1 = await signatureTokenFor(qp)
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/batches/${batchId}/release`), qp)
        .send({ decision: 'released', riskAcceptances: [], intentStatement: 'release', signatureToken: releaseToken1 })
        .expect(409)

      const releaseToken2 = await signatureTokenFor(qp)
      const released = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/batches/${batchId}/release`),
        qp,
      )
        .send({
          decision: 'released',
          riskAcceptances: [{ recordType: 'quality_deviation', recordId: deviationId, reason: 'Unrelated to this batch, confirmed by QA' }],
          intentStatement: 'I release this batch for distribution',
          signatureToken: releaseToken2,
        })
        .expect(201)
      expect(released.body.data.decision).toBe('released')

      const batch = await withBypass((tx) => tx.batch.findUniqueOrThrow({ where: { id: batchId } }))
      expect(batch.qualityStatus).toBe('released')
    })

    it('rejects a release attempt from an actor who lacks quality.manage_batch_release', async () => {
      const qm = await actorWith('QUALITY_MANAGER')
      await setUpReviewedBatch(qm)
      const token = await signatureTokenFor(qm)
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/batches/${batchId}/release`), qm)
        .send({ decision: 'released', riskAcceptances: [], intentStatement: 'release', signatureToken: token })
        .expect(403)
    })
  })

  describe('Stage 18 — Validation (Process/Cleaning/Method) & Computer System Validation', () => {
    it('drafts a protocol as a real controlled document, drives it to Effective, then records a report and finalizes its conclusion', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const approver = await actorWith('QUALITY_MANAGER')

      const createdProtocol = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/validation-protocols'),
        author,
      )
        .send({
          title: 'Cleaning Validation — Granulation Line 1',
          validationType: 'cleaning',
          documentNumber: 'VAL-CLN-001',
        })
        .expect(201)
      const protocolId = createdProtocol.body.data.id as string
      const sopId = createdProtocol.body.data.protocolDocumentId as string
      expect(createdProtocol.body.data.protocolDocument.status).toBe('draft')

      // Execution is blocked before the protocol document is effective.
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/validation-protocols/${protocolId}/reports`),
        approver,
      )
        .send({ conclusion: 'validated' })
        .expect(409)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), author)
        .send({ toStateKey: 'in_review' })
        .expect(201)
      const approveToken = await signatureTokenFor(approver)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), approver)
        .send({ toStateKey: 'approved', signatureToken: approveToken, intentStatement: 'I approve this validation protocol' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), approver)
        .send({ toStateKey: 'effective' })
        .expect(201)

      const report = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/validation-protocols/${protocolId}/reports`),
        approver,
      )
        .send({ conclusion: 'validated', executionRecords: { runs: 3, allPassed: true } })
        .expect(201)
      expect(report.body.data.conclusion).toBe('validated')

      const finalized = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/validation-protocols/reports/${report.body.data.id}/finalize`),
        approver,
      )
        .send({ conclusion: 'conditionally_validated' })
        .expect(201)
      expect(finalized.body.data.conclusion).toBe('conditionally_validated')

      // A draft-level actor (QUALITY_ASSOCIATE) cannot finalize a report — senior-only action.
      const authorToken = await signatureTokenFor(author)
      void authorToken
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/validation-protocols/reports/${report.body.data.id}/finalize`),
        author,
      )
        .send({ conclusion: 'validated' })
        .expect(403)
    })
  })
})
