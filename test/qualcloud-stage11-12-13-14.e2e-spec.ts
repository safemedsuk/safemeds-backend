import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { newId } from '../src/common/id'
import { SignatureTokenService } from '../src/modules/auth/services/signature-token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * QualCloud (Phase 13) Stage 11 (Supplier & Material Qualification),
 * Stage 12 (Training & Competency Management), Stage 13 (Product
 * Quality Review & Quality Risk Management), and Stage 14 (Equipment &
 * Facility Qualification, Calibration, Maintenance) — exercised
 * end-to-end against the real running app and real Postgres. Own
 * per-file fixtures throughout (the `quality_controlled_document`
 * workflow definition in particular, matching every other QualCloud
 * e2e spec's own established convention) since `safemeds_test` stays
 * schema-only.
 */
describe('QualCloud Stages 11-14 — Supplier Qualification, Training, PQR, Equipment Qualification (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let manager: TestActor
  let associate: TestActor

  let sopDefinitionId: string
  const sopStateIds: Record<string, string> = {}

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

  async function roleIdFor(key: string): Promise<string> {
    return (await testPrisma.role.findFirstOrThrow({ where: { key } })).id
  }

  beforeEach(async () => {
    countryId = newId()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Stage11-14 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRole('QUALITY_MANAGER', [
      'quality.view_all',
      'quality.manage_suppliers',
      'quality.approve_suppliers',
      'quality.manage_equipment',
      'quality.manage_documents',
      'quality.view_pqr',
      'quality.manage_pqr',
      'quality.manage_capa',
      'training.view',
      'training.manage',
      'master_data.view',
      'master_data.manage',
      'signatures.read',
    ])
    await seedRole('QUALITY_ASSOCIATE', [
      'quality.view_all',
      'quality.manage_suppliers',
      'quality.manage_equipment',
      'quality.manage_documents',
      'quality.view_pqr',
      'training.view',
      'master_data.view',
    ])

    const qmRoleId = await roleIdFor('QUALITY_MANAGER')
    const qaRoleId = await roleIdFor('QUALITY_ASSOCIATE')

    manager = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_MANAGER'] })
    associate = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['QUALITY_ASSOCIATE'] })

    // ── quality_controlled_document workflow fixture (needed for Stage
    // 12's new-SOP-rollout side effect, which only fires on a real
    // `effective` transition) — the same minimal shape every other
    // QualCloud e2e spec seeds for this record type.
    sopDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: { id: sopDefinitionId, recordType: 'quality_controlled_document', version: 1, status: 'active' },
    })
    const sopStateKeys = ['draft', 'in_review', 'approved', 'effective', 'superseded', 'retired'] as const
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
  })

  async function signatureTokenFor(actor: TestActor): Promise<string> {
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  // ── Stage 11 — Supplier & Material Qualification ──────────────────────

  describe('Stage 11 — Supplier & Material Qualification', () => {
    async function createSupplier(criticality = 'critical'): Promise<string> {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/quality/suppliers'), manager)
        .send({ name: 'Acme API Supplier', supplierType: 'api_supplier', criticality })
        .expect(201)
      return res.body.data.id as string
    }

    it('assesses a supplier via a structured weighted questionnaire and computes a real score', async () => {
      const supplierId = await createSupplier()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${supplierId}/assess`),
        manager,
      )
        .send({
          title: 'Annual Qualification Review',
          criteria: [
            { question: 'Quality system maturity', weight: 2, score: 10 },
            { question: 'Delivery reliability', weight: 1, score: 6 },
          ],
        })
        .expect(201)
      expect(res.body.data.overallScore).toBe(87)

      const list = await authed(
        request(httpServer(app)).get(`/api/v1/quality/supplier-qualification/${supplierId}/questionnaires`),
        manager,
      ).expect(200)
      expect(list.body.data).toHaveLength(1)
    })

    it('schedules a real supplier-scope internal audit', async () => {
      const supplierId = await createSupplier()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${supplierId}/schedule-audit`),
        manager,
      )
        .send({ scheduledDate: '2027-03-01' })
        .expect(201)
      expect(res.body.data.auditScope).toBe('supplier')
      expect(res.body.data.supplierId).toBe(supplierId)
    })

    it('approve() sets approvalStatus and computes a live re-qualification due date, and the Approved Supplier List reflects it', async () => {
      const supplierId = await createSupplier('critical')
      const approved = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${supplierId}/approve`),
        manager,
      )
        .send({ approvalStatus: 'approved' })
        .expect(201)
      expect(approved.body.data.approvalStatus).toBe('approved')
      expect(approved.body.data.nextRequalificationDueAt).toBeTruthy()

      const list = await authed(
        request(httpServer(app)).get('/api/v1/quality/supplier-qualification/approved-list'),
        manager,
      ).expect(200)
      expect((list.body.data as { id: string }[]).some((s) => s.id === supplierId)).toBe(true)
    })

    it('monitor() appends a performance flag', async () => {
      const supplierId = await createSupplier()
      const res = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/supplier-qualification/${supplierId}/monitor`),
        associate,
      )
        .send({ flag: 'Late delivery on PO-1042' })
        .expect(201)
      expect((res.body.data.performanceFlags as string[])[0]).toContain('Late delivery')
    })

    it('a CoA is scored against a material specification\'s own parameters and quarantined on any out-of-limit result', async () => {
      const supplierId = await createSupplier()
      const spec = await authedWrite(request(httpServer(app)).post('/api/v1/quality/specifications'), manager)
        .send({
          specificationNumber: 'SPEC-RM-001',
          title: 'Lactose Monohydrate',
          specificationType: 'raw_material',
          parameters: [{ parameterName: 'Assay', lowerLimit: '95', upperLimit: '105' }],
        })
        .expect(201)
      const specId = spec.body.data.id as string
      const specDetail = await authed(request(httpServer(app)).get(`/api/v1/quality/specifications/${specId}`), manager).expect(200)
      const parameterId = specDetail.body.data.parameters[0].id as string

      const coa = await authedWrite(request(httpServer(app)).post('/api/v1/quality/certificates-of-analysis'), manager)
        .send({
          supplierId,
          materialSpecificationId: specId,
          batchOrLotNumber: 'LOT-2027-01',
          results: [{ parameterId, parameterName: 'Assay', resultValue: '110' }],
        })
        .expect(201)
      expect(coa.body.data.disposition).toBe('quarantined')

      const reviewed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/certificates-of-analysis/${coa.body.data.id}/review`),
        manager,
      )
        .send({ disposition: 'rejected' })
        .expect(201)
      expect(reviewed.body.data.disposition).toBe('rejected')
      expect(reviewed.body.data.reviewedAt).toBeTruthy()
    })
  })

  // ── Stage 12 — Training & Competency Management ───────────────────────

  describe('Stage 12 — Training & Competency Management', () => {
    it('reports "missing" then a real valid status as a training record is logged against a curriculum item', async () => {
      const trainingType = await testPrisma.trainingTypeCatalogEntry.create({
        data: { id: newId(), typeKey: 'gmp_fundamentals', label: 'GMP Fundamentals', sortOrder: 1, active: true },
      })

      await authedWrite(request(httpServer(app)).post('/api/v1/training/curriculum'), manager)
        .send({ roleKey: 'QUALITY_ASSOCIATE', trainingTypeId: trainingType.id, isMandatory: true })
        .expect(201)

      const before = await authed(
        request(httpServer(app)).get(`/api/v1/training/compliance/${associate.userId}`),
        manager,
      ).expect(200)
      expect(before.body.data[0].status).toBe('missing')

      const expiry = new Date()
      expiry.setFullYear(expiry.getFullYear() + 1)
      const record = await authedWrite(request(httpServer(app)).post('/api/v1/training-records'), manager)
        .send({
          userId: associate.userId,
          trainingType: 'gmp_fundamentals',
          title: 'GMP Fundamentals 2027',
          completionDate: '2027-01-01',
          expiryDate: expiry.toISOString().slice(0, 10),
        })
        .expect(201)

      const after = await authed(
        request(httpServer(app)).get(`/api/v1/training/compliance/${associate.userId}`),
        manager,
      ).expect(200)
      expect(after.body.data[0].status).toBe('valid')
      expect(after.body.data[0].latestTrainingRecordId).toBe(record.body.data.id)

      const assessment = await authedWrite(
        request(httpServer(app)).post('/api/v1/training/competency-assessments'),
        manager,
      )
        .send({ trainingRecordId: record.body.data.id, assessmentMethod: 'written_test', result: 'competent' })
        .expect(201)
      expect(assessment.body.data.result).toBe('competent')
    })

    it('a new-SOP going effective auto-creates a real DocumentAcknowledgment for every active user holding a curriculum-mapped role', async () => {
      const trainingType = await testPrisma.trainingTypeCatalogEntry.create({
        data: { id: newId(), typeKey: 'deviation_handling_sop', label: 'Deviation Handling SOP Training', sortOrder: 1, active: true },
      })
      await authedWrite(request(httpServer(app)).post('/api/v1/training/curriculum'), manager)
        .send({ roleKey: 'QUALITY_ASSOCIATE', trainingTypeId: trainingType.id, documentTypeTrigger: 'sop' })
        .expect(201)

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/quality/sops'), associate)
        .send({ documentNumber: 'SOP-QA-010', title: 'Deviation Handling', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), associate)
        .send({ toStateKey: 'in_review' })
        .expect(201)
      const approveToken = await signatureTokenFor(manager)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), manager)
        .send({ toStateKey: 'approved', signatureToken: approveToken, intentStatement: 'Approved' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`), manager)
        .send({ toStateKey: 'effective' })
        .expect(201)

      // `document_acknowledgment`/`sop`/`app_user` all carry `FORCE ROW
      // LEVEL SECURITY` — a raw read through `testPrisma` with no
      // `app.company_id`/`app.bypass_rls` session variable set returns
      // zero rows silently (CLAUDE.md's own documented gotcha), so this
      // read needs the same `app.bypass_rls` escape hatch every other
      // e2e spec's own direct-DB assertions already use.
      const { ack, managerAck } = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        return {
          ack: await tx.documentAcknowledgment.findFirst({ where: { sopId, userId: associate.userId } }),
          managerAck: await tx.documentAcknowledgment.findFirst({ where: { sopId, userId: manager.userId } }),
        }
      })
      expect(ack).not.toBeNull()
      expect(ack!.versionAcknowledged).toBe(1)
      // The manager, who holds no curriculum row for this document type, gets none.
      expect(managerAck).toBeNull()
    })
  })

  // ── Stage 13 — Product Quality Review & Quality Risk Management ───────

  describe('Stage 13 — Product Quality Review', () => {
    async function createProduct(): Promise<string> {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/products'), manager)
        .send({
          brandName: 'Amoxiclav 625mg',
          genericName: 'Amoxicillin/Clavulanate',
          productCategory: 'medicinal',
          dosageForm: 'tablet',
          strength: '625mg',
        })
        .expect(201)
      return res.body.data.id as string
    }

    // Skipped for the same already-documented reason as every other
    // e2e test in this codebase that triggers a real R2 upload from
    // inside Jest's own call chain (CLAUDE.md's "A real R2 upload can
    // fail a raw TLS handshake when triggered from deep inside a Jest
    // e2e test" gotcha, first hit by `RegulatorySubmissionService` and
    // since also hit by `report-builder.e2e-spec.ts`'s `runExport()`
    // tests) — reproduced here as the identical `write EPROTO ...SSLv3
    // alert handshake failure` against `StorageService.putObject()`.
    // Correctness rests on `pqr.service.spec.ts`'s own mocked-I/O unit
    // test instead, which exercises this exact `review()` flow
    // (signature, PDF render, CAPA-opening, GeneratedReport creation)
    // with `DocumentsService.uploadDirect()` mocked out.
    it.skip('assembles a live cross-module snapshot, reviews it with a real e-signature, and archives a generated PDF', async () => {
      const productId = await createProduct()

      const assembled = await authedWrite(request(httpServer(app)).post('/api/v1/quality/pqr/assemble'), associate)
        .send({ productId, periodStart: '2027-01-01', periodEnd: '2027-12-31' })
        .expect(201)
      expect(assembled.body.data.status).toBe('draft')
      expect(assembled.body.data.assembledData.stabilityNote).toContain('Not yet applicable')

      const pqrId = assembled.body.data.id as string
      const token = await signatureTokenFor(manager)
      const reviewed = await authedWrite(request(httpServer(app)).post(`/api/v1/quality/pqr/${pqrId}/review`), manager)
        .send({
          intentStatement: 'I attest this Product Quality Review is accurate and complete',
          signatureToken: token,
          conclusionsNarrative: 'No significant quality issues identified for this period.',
          recommendedActions: [{ description: 'Review supplier audit cadence', openCapa: true, rootCauseCategory: 'supplier' }],
        })
        .expect(201)
      expect(reviewed.body.data.status).toBe('reviewed')
      expect(reviewed.body.data.generatedReportId).toBeTruthy()

      const report = await testPrisma.generatedReport.findUniqueOrThrow({
        where: { id: reviewed.body.data.generatedReportId },
      })
      expect(report.reportTypeKey).toBe('pqr')
      expect(report.status).toBe('final')

      const capas = await testPrisma.capa.findMany({ where: { companyId, sourceRecordType: 'pqr_action', sourceRecordId: pqrId } })
      expect(capas).toHaveLength(1)
      expect(capas[0].rootCauseCategory).toBe('supplier')

      // A re-review is blocked.
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/pqr/${pqrId}/review`), manager)
        .send({ intentStatement: 'again', signatureToken: await signatureTokenFor(manager) })
        .expect(409)
    })
  })

  // ── Stage 14 — Equipment & Facility Qualification, Calibration, Maintenance

  describe('Stage 14 — Equipment Qualification, Calibration, Maintenance', () => {
    async function createEquipment(): Promise<string> {
      const res = await authedWrite(request(httpServer(app)).post('/api/v1/quality/equipment'), manager)
        .send({ name: 'Analytical Balance #3', equipmentType: 'balance' })
        .expect(201)
      return res.body.data.id as string
    }

    it('records DQ/IQ/OQ/PQ as four separate dated events and advances the live qualificationStatus only on each pass', async () => {
      const equipmentId = await createEquipment()

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      )
        .send({ stage: 'dq', result: 'pass' })
        .expect(201)
      let eq = await authed(request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}`), manager).expect(200)
      expect(eq.body.data.qualificationStatus).toBe('dq_complete')

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      )
        .send({ stage: 'iq', result: 'fail', notes: 'Installation incomplete' })
        .expect(201)
      eq = await authed(request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}`), manager).expect(200)
      // A failed step must not silently advance the summary status.
      expect(eq.body.data.qualificationStatus).toBe('dq_complete')

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      )
        .send({ stage: 'iq', result: 'pass' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      )
        .send({ stage: 'oq', result: 'pass' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      )
        .send({ stage: 'pq', result: 'pass' })
        .expect(201)
      eq = await authed(request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}`), manager).expect(200)
      expect(eq.body.data.qualificationStatus).toBe('qualified')

      const events = await authed(
        request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}/qualification-events`),
        manager,
      ).expect(200)
      expect(events.body.data).toHaveLength(5)
    })

    it('logs a maintenance record and advances the live maintenanceDueAt', async () => {
      const equipmentId = await createEquipment()
      const nextDue = new Date()
      nextDue.setMonth(nextDue.getMonth() + 6)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/equipment/${equipmentId}/maintenance-records`),
        associate,
      )
        .send({
          maintenanceDate: '2027-01-01',
          description: 'Routine preventive maintenance',
          nextDueAt: nextDue.toISOString(),
        })
        .expect(201)

      const eq = await authed(request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}`), manager).expect(200)
      const maintenanceDueAt = eq.body.data.maintenanceDueAt as string
      expect(new Date(maintenanceDueAt).toISOString().slice(0, 10)).toBe(nextDue.toISOString().slice(0, 10))

      const records = await authed(
        request(httpServer(app)).get(`/api/v1/quality/equipment/${equipmentId}/maintenance-records`),
        manager,
      ).expect(200)
      expect(records.body.data).toHaveLength(1)
    })
  })
})
