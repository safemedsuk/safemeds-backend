import { INestApplication } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { SignatureTokenService } from '../src/modules/auth/services/signature-token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/** `case`/`complaint`/`batch` all carry `FORCE ROW LEVEL SECURITY` — a raw `testPrisma` read with no `app.company_id`/`app.bypass_rls` session var set returns nothing, not an error (CLAUDE.md's own documented gotcha). Same bypass technique `pv-case.e2e-spec.ts`/`qualcloud-stage1-2-3.e2e-spec.ts` already establish. */
function readWithBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx)
  })
}

/** Pass A2 — the real document upload goes to R2, unreachable from Jest (documented TLS gotcha). Attachment rules are asserted against a real `Document` row seeded directly. */
async function seedDocument(
  companyId: string,
  recordType: string,
  recordId: string,
): Promise<void> {
  await testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    await tx.document.create({
      data: { id: randomUUID(), companyId, recordType, recordId, title: 'e2e evidence' },
    })
  })
}

/** Pass A2 — the full CAPA allocation body every opener now requires. */
function allocation(
  ownerUserId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rootCause: 'Packaging seal line pressure drifted out of range',
    rootCauseCategory: 'equipment_calibration',
    correctiveAction: 'Recalibrate seal line pressure transducer',
    ownerUserId,
    correctiveActionDueDate: '2026-12-01',
    ...extra,
  }
}

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
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
    create: {
      id: roleId,
      key: roleKey,
      name: roleKey,
      description: 'e2e fixture',
      isPlatform: false,
    },
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
 * QualCloud (Phase 13) Stages 4 (Change Control), 5 (Complaint
 * Handling), 6 (OOS/OOT Investigation), and 7 (Batch Traceability,
 * Record Review & Disposition) — walked end to end against the real
 * running app. This e2e database is truncated per test and never runs
 * the dev seed, so this file defines its own `quality_change_control`/
 * `quality_complaint`/`quality_oos` workflow fixtures directly, matching
 * every other stage's own established per-file-fixture convention.
 *
 * `ChangeControlService.openLinkedVariation()`'s real success path is
 * deliberately NOT exercised here — it calls the real, already fully
 * e2e-tested `RegVariationService.create()`, which itself requires the
 * complete `reg_registration` 9-state/11-transition workflow plus a
 * real `RegDossier`/completeness-gate setup (`regcloud-stage4-5-6-7
 * .e2e-spec.ts`'s own ~150-line fixture). Duplicating that entire
 * fixture here to exercise a cross-module call this codebase's own
 * `RegVariationService.create()` already proves works would be
 * disproportionate — this file covers every one of `openLinkedVariation()`'s
 * own guard/validation paths (no regulatory impact, no registration
 * known) at the HTTP layer instead, with the happy path already proven
 * at the unit level (`change-control.service.spec.ts`, 5 dedicated
 * tests including the real `RegVariationService.create()` call
 * assertion).
 */
describe('QualCloud Stage 4/5/6/7 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let qaRoleId: string
  let qmRoleId: string
  let raRoleId: string
  let productId: string
  let batchId: string
  let specificationId: string
  let parameterId: string
  let changeControlDefinitionId: string
  let complaintDefinitionId: string
  let oosDefinitionId: string

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
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Stage 4-7 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    qaRoleId = randomUUID()
    qmRoleId = randomUUID()
    raRoleId = randomUUID()
    await seedRoleWithPermissions(qaRoleId, 'QUALITY_ASSOCIATE', [
      'quality.log_deviation',
      'quality.manage_capa',
      'quality.view_all',
      'quality.manage_documents',
      'master_data.view',
      'master_data.manage',
    ])
    await seedRoleWithPermissions(qmRoleId, 'QUALITY_MANAGER', [
      'quality.log_deviation',
      'quality.close_capa',
      'quality.manage_capa',
      'quality.view_all',
      'quality.review_batch_records',
    ])
    await seedRoleWithPermissions(raRoleId, 'REGULATORY_AFFAIRS_OFFICER', [
      'regulatory.manage_registrations',
      'quality.log_deviation',
    ])

    // `product`/`batch`/`specification`/`specification_parameter` all
    // carry `FORCE ROW LEVEL SECURITY` — created through the real API,
    // not raw `testPrisma.*.create()`, matching `regcloud-stage0
    // .e2e-spec.ts`'s own established precedent for RLS-forced tables.
    const setupActor = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['QUALITY_ASSOCIATE'],
    })

    const productRes = await authedWrite(
      request(httpServer(app)).post('/api/v1/products'),
      setupActor,
    )
      .send({
        brandName: 'Amoxil',
        genericName: 'Amoxicillin',
        productCategory: 'medicinal',
        dosageForm: 'Tablet',
        strength: '500mg',
      })
      .expect(201)
    productId = productRes.body.data.id as string

    const batchRes = await authedWrite(request(httpServer(app)).post('/api/v1/batches'), setupActor)
      .send({
        productId,
        batchNumber: 'B2026-001',
        manufacturedOn: '2026-01-01',
        expiresOn: '2028-01-01',
      })
      .expect(201)
    batchId = batchRes.body.data.id as string

    const specRes = await authedWrite(
      request(httpServer(app)).post('/api/v1/quality/specifications'),
      setupActor,
    )
      .send({
        specificationNumber: 'SPEC-001',
        title: 'Amoxicillin 500mg Tablets',
        specificationType: 'finished_product',
        productId,
        parameters: [
          { parameterName: 'Assay', lowerLimit: '99.0', upperLimit: '101.0', unit: '%' },
        ],
      })
      .expect(201)
    specificationId = specRes.body.data.id as string
    parameterId = specRes.body.data.parameters[0].id as string

    await testPrisma.reportType.upsert({
      where: { typeKey: 'adr' },
      update: {},
      create: { id: randomUUID(), typeKey: 'adr', moduleKey: 'pv', name: 'Suspected ADR' },
    })

    // Minimal `pv_case` fixture, required so `PvCaseService
    // .createFromSystemChannel()`'s call into `WorkflowService
    // .instantiate()` finds an initial state — same minimal shape
    // `vigicloud-stage3-public-reporting.e2e-spec.ts` already
    // established for exactly this purpose.
    const pvCaseDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: pvCaseDefinitionId,
        recordType: 'pv_case',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    await testPrisma.workflowState.create({
      data: {
        id: randomUUID(),
        definitionId: pvCaseDefinitionId,
        stateKey: 'intake',
        name: 'Intake',
        isInitial: true,
        isTerminal: true,
      },
    })

    // Minimal `quality_deviation` fixture — this file's own Stage 7
    // traceability test creates a real `Deviation` to prove it shows up
    // linked to a batch; it's never transitioned here, so a bare
    // initial state is enough (`DeviationService.create()`'s own
    // `WorkflowService.instantiate()` call just needs one to exist).
    const deviationDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: deviationDefinitionId,
        recordType: 'quality_deviation',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    await testPrisma.workflowState.create({
      data: {
        id: randomUUID(),
        definitionId: deviationDefinitionId,
        stateKey: 'detected',
        name: 'Detected',
        isInitial: true,
        isTerminal: false,
      },
    })

    // ── quality_change_control workflow fixture ────────────────────────
    changeControlDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: changeControlDefinitionId,
        recordType: 'quality_change_control',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    const ccStateKeys = [
      'proposed',
      'impact_assessment',
      'approved',
      'implementing',
      'verifying',
      'closed',
    ] as const
    const ccStateIds: Record<string, string> = {}
    for (const key of ccStateKeys) ccStateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: ccStateKeys.map((key) => ({
        id: ccStateIds[key],
        definitionId: changeControlDefinitionId,
        stateKey: key,
        name: key,
        isInitial: key === 'proposed',
        isTerminal: key === 'closed',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        {
          id: randomUUID(),
          definitionId: changeControlDefinitionId,
          fromStateId: ccStateIds.proposed,
          toStateId: ccStateIds.impact_assessment,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: changeControlDefinitionId,
          fromStateId: ccStateIds.impact_assessment,
          toStateId: ccStateIds.approved,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
        {
          id: randomUUID(),
          definitionId: changeControlDefinitionId,
          fromStateId: ccStateIds.approved,
          toStateId: ccStateIds.implementing,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: changeControlDefinitionId,
          fromStateId: ccStateIds.implementing,
          toStateId: ccStateIds.verifying,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: changeControlDefinitionId,
          fromStateId: ccStateIds.verifying,
          toStateId: ccStateIds.closed,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
      ],
    })

    // ── quality_complaint workflow fixture ──────────────────────────────
    complaintDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: complaintDefinitionId,
        recordType: 'quality_complaint',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    const cmpStateKeys = ['intake', 'classifying', 'investigating', 'resolved'] as const
    const cmpStateIds: Record<string, string> = {}
    for (const key of cmpStateKeys) cmpStateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: cmpStateKeys.map((key) => ({
        id: cmpStateIds[key],
        definitionId: complaintDefinitionId,
        stateKey: key,
        name: key,
        isInitial: key === 'intake',
        isTerminal: key === 'resolved',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        {
          id: randomUUID(),
          definitionId: complaintDefinitionId,
          fromStateId: cmpStateIds.intake,
          toStateId: cmpStateIds.classifying,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: complaintDefinitionId,
          fromStateId: cmpStateIds.classifying,
          toStateId: cmpStateIds.investigating,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: complaintDefinitionId,
          fromStateId: cmpStateIds.investigating,
          toStateId: cmpStateIds.resolved,
          requiredRoleId: qmRoleId,
          requiresSignature: false,
        },
      ],
    })

    // ── quality_oos workflow fixture ────────────────────────────────────
    oosDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: oosDefinitionId,
        recordType: 'quality_oos',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    const oosStateKeys = [
      'phase_1_lab_investigation',
      'phase_2_manufacturing_investigation',
      'closed',
    ] as const
    const oosStateIds: Record<string, string> = {}
    for (const key of oosStateKeys) oosStateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: oosStateKeys.map((key) => ({
        id: oosStateIds[key],
        definitionId: oosDefinitionId,
        stateKey: key,
        name: key,
        isInitial: key === 'phase_1_lab_investigation',
        isTerminal: key === 'closed',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        {
          id: randomUUID(),
          definitionId: oosDefinitionId,
          fromStateId: oosStateIds.phase_1_lab_investigation,
          toStateId: oosStateIds.phase_2_manufacturing_investigation,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: oosDefinitionId,
          fromStateId: oosStateIds.phase_1_lab_investigation,
          toStateId: oosStateIds.closed,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
        {
          id: randomUUID(),
          definitionId: oosDefinitionId,
          fromStateId: oosStateIds.phase_2_manufacturing_investigation,
          toStateId: oosStateIds.closed,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
      ],
    })
  })

  describe('Stage 4 — Change Control', () => {
    it('walks Proposed → Impact Assessment → (blocked on missing approvals) → Approved → Implementing → Verifying → (blocked on missing verification) → Closed', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/change-controls'),
        qa,
      )
        .send({
          title: 'Switch excipient supplier',
          changeType: 'minor',
          scope: 'supplier',
          changeDescription: 'New excipient supplier qualified',
        })
        .expect(201)
      const changeControlId = created.body.data.id as string
      expect(created.body.data.status).toBe('proposed')
      expect(created.body.data.changeNumber).toMatch(/^CC-\d{4}-\d{5}$/)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_change_control', recordId: changeControlId },
      })

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qa,
      )
        .send({ toStateKey: 'impact_assessment' })
        .expect(201)

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/impact-assessment`,
        ),
        qa,
      )
        .send({
          regulatoryImpact: { impacted: false },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        })
        .expect(201)

      // Blocked: no cross-functional approval recorded yet.
      const approveToken = await signatureTokenFor(qm)
      const blocked = await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'approved',
          signatureToken: approveToken,
          intentStatement: 'I approve this change',
        })
        .expect(409)
      expect(blocked.body.error.message).toContain('QUALITY_MANAGER')

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/approval`,
        ),
        qm,
      )
        .send({ note: 'Approved after review' })
        .expect(201)

      const approveToken2 = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'approved',
          signatureToken: approveToken2,
          intentStatement: 'I approve this change',
        })
        .expect(201)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qa,
      )
        .send({ toStateKey: 'implementing' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qa,
      )
        .send({ toStateKey: 'verifying' })
        .expect(201)

      // Blocked: no verification result recorded yet.
      const closeToken = await signatureTokenFor(qm)
      const blockedClose = await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken,
          intentStatement: 'Close this change',
        })
        .expect(409)
      expect(blockedClose.body.error.message).toContain('Verification')

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/implementation`,
        ),
        qa,
      )
        .send({
          implementationRecord: 'Rolled out to production line 2',
          verificationResult: 'No adverse effect observed on 3 subsequent batches',
        })
        .expect(201)

      const closeToken2 = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken2,
          intentStatement: 'Close this change',
        })
        .expect(201)

      const final = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { id: instance.id },
        include: { currentState: true },
      })
      expect(final.currentState.stateKey).toBe('closed')
      const afterClose = await authed(
        request(httpServer(app)).get(`/api/v1/quality/change-controls/${changeControlId}`),
        qm,
      ).expect(200)
      expect(afterClose.body.data.status).toBe('closed')
      expect(afterClose.body.data.closedAt).not.toBeNull()
    })

    it('openLinkedVariation() rejects when no regulatory impact is flagged, and when the affected registration is unknown', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const ra = await actorWith('REGULATORY_AFFAIRS_OFFICER')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/change-controls'),
        qa,
      )
        .send({ title: 'Label wording update', changeType: 'like_for_like', scope: 'labeling' })
        .expect(201)
      const changeControlId = created.body.data.id as string

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/open-linked-variation`,
        ),
        ra,
      )
        .send({})
        .expect(409)

      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/impact-assessment`,
        ),
        qa,
      )
        .send({
          regulatoryImpact: { impacted: true },
          validationImpact: { impacted: false },
          productSafetyImpact: { impacted: false },
          stabilityImpact: { impacted: false },
          otherSpecificationsImpact: { impacted: false },
        })
        .expect(201)

      const missingRegistration = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/change-controls/${changeControlId}/open-linked-variation`,
        ),
        ra,
      )
        .send({})
        .expect(400)
      expect(missingRegistration.body.error.code).toBe('PRODUCT_REGISTRATION_REQUIRED')
    })
  })

  describe('Stage 5 — Complaint Handling', () => {
    it('classifies a quality complaint (no PV routing), investigates, and resolves it', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/complaints'),
        qa,
      )
        .send({ productId, channel: 'phone', description: 'Blister pack seal was broken' })
        .expect(201)
      const complaintId = created.body.data.id as string
      expect(created.body.data.complaintNumber).toMatch(/^CMP-\d{4}-\d{5}$/)

      const classified = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/classify`),
        qa,
      )
        .send({ classification: 'quality_complaint', severity: 'minor' })
        .expect(201)
      expect(classified.body.data.classification).toBe('quality_complaint')
      expect(classified.body.data.routedCaseId).toBeNull()

      await testPrisma.workflowInstance
        .findFirstOrThrow({ where: { recordType: 'quality_complaint', recordId: complaintId } })
        .then(async (instance) => {
          await authedWrite(
            request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
            qa,
          )
            .send({ toStateKey: 'investigating' })
            .expect(201)
        })

      // Pass A2 (item 4d) — resolution is refused until a substantiating document is attached.
      const unsubstantiated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/resolve`),
        qm,
      )
        .send({ resolutionNote: 'Root-caused to a single packaging line fault, corrected' })
        .expect(409)
      expect(unsubstantiated.body.error.code).toBe('SUBSTANTIATION_REQUIRED')
      await seedDocument(companyId, 'quality_complaint_substantiation', complaintId)

      const resolved = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/resolve`),
        qm,
      )
        .send({ resolutionNote: 'Root-caused to a single packaging line fault, corrected' })
        .expect(201)
      expect(resolved.body.data.resolutionNote).toBe(
        'Root-caused to a single packaging line fault, corrected',
      )
      expect(resolved.body.data.resolvedAt).not.toBeNull()

      const afterResolve = await authed(
        request(httpServer(app)).get(`/api/v1/quality/complaints/${complaintId}`),
        qm,
      ).expect(200)
      expect(afterResolve.body.data.status).toBe('resolved')

      const kpi = await authed(
        request(httpServer(app)).get('/api/v1/quality/complaints/resolution-time-kpi'),
        qm,
      ).expect(200)
      expect(kpi.body.data.resolvedCount).toBe(1)
    })

    it('routes a possible_ae complaint to a real PV case, never re-routing on a repeat classify', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/complaints'),
        qa,
      )
        .send({
          productId,
          channel: 'distributor',
          description: 'Patient reported dizziness after taking the tablet',
        })
        .expect(201)
      const complaintId = created.body.data.id as string

      const classified = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/classify`),
        qa,
      )
        .send({ classification: 'possible_ae' })
        .expect(201)
      expect(classified.body.data.routedCaseId).toBeTruthy()

      const routedCase = await readWithBypass((tx) =>
        tx.case.findUnique({ where: { id: classified.body.data.routedCaseId as string } }),
      )
      expect(routedCase).not.toBeNull()
      expect(routedCase?.channel).toBe('quality_complaint_routed')
      expect(routedCase?.sourceChannelReference).toBe(complaintId)

      // Repeat classify (an actual real-world scenario: reclassifying
      // details later) never opens a second PV case.
      const secondClassify = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/classify`),
        qa,
      )
        .send({ classification: 'possible_ae' })
        .expect(409) // classifying → classifying isn't a real transition once already past it
      expect(secondClassify.body).toBeDefined()
    })

    it('opens a CAPA against a complaint via the deviation-style endpoint (not every complaint needs one)', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/complaints'),
        qa,
      )
        .send({ productId, channel: 'email', description: 'Recurrent packaging defect' })
        .expect(201)
      const complaintId = created.body.data.id as string

      const capa = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/complaints/${complaintId}/capa`),
        qa,
      )
        .send(allocation(qa.userId))
        .expect(201)
      expect(capa.body.data.ownerUserId).toBe(qa.userId)
      expect(capa.body.data.sourceRecordType).toBe('complaint')
      expect(capa.body.data.sourceRecordId).toBe(complaintId)
    })

    it('accepts a public complaint submission with createdBy null', async () => {
      await testPrisma.company.update({
        where: { id: companyId },
        data: { publicReportingSlug: 'qualcloud-stage4-7-co' },
      })

      const res = await request(httpServer(app))
        .post('/api/v1/report/qualcloud-stage4-7-co/complaint')
        .send({
          productId,
          description: 'Box arrived crushed',
          reporterEmail: 'customer@example.com',
        })
        .expect(201)
      expect(res.body.data.complaintNumber).toMatch(/^CMP-\d{4}-\d{5}$/)

      const stored = await readWithBypass((tx) =>
        tx.complaint.findFirst({
          where: { companyId, complaintNumber: res.body.data.complaintNumber },
        }),
      )
      expect(stored?.createdBy).toBeNull()
      expect(stored?.channel).toBe('distributor')
    })
  })

  describe('Stage 6 — OOS/OOT Investigation', () => {
    it('closes directly from Phase 1 once a documented assignable lab cause exists', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/quality/oos'), qa)
        .send({ batchId, specificationId, parameterId, testResult: '98.5% assay' })
        .expect(201)
      const oosId = created.body.data.id as string
      expect(created.body.data.oosNumber).toMatch(/^OOS-\d{4}-\d{5}$/)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_oos', recordId: oosId },
      })

      // Blocked: no assignable cause recorded yet.
      const blockToken = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({ toStateKey: 'closed', signatureToken: blockToken, intentStatement: 'Close' })
        .expect(409)

      // Pass A2: Phase 1 findings text needs an attached finding document first.
      await seedDocument(companyId, 'oos_finding', oosId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/phase1`), qa)
        .send({
          assignableCauseFound: true,
          findings: 'Analyst pipetting error, confirmed via retraining log',
        })
        .expect(201)

      const closeToken = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken,
          intentStatement: 'Close — assignable lab cause confirmed',
        })
        .expect(201)

      const final = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { id: instance.id },
        include: { currentState: true },
      })
      expect(final.currentState.stateKey).toBe('closed')
    })

    it('requires a written retest rationale, then walks Phase 1 → Phase 2 → real batch impact → Closed', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/quality/oos'), qa)
        .send({ batchId, specificationId, parameterId, testResult: '96.0% assay' })
        .expect(201)
      const oosId = created.body.data.id as string

      // Pass A2 (item 4b) — findings text is refused until a finding document is attached.
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/phase1`), qa)
        .send({ assignableCauseFound: false, findings: 'No lab error identified' })
        .expect(409)
      await seedDocument(companyId, 'oos_finding', oosId)
      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/phase1`), qa)
        .send({ assignableCauseFound: false, findings: 'No lab error identified' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/retest`), qa)
        .send({
          authorized: true,
          rationale:
            'No assignable cause found in Phase 1 — retest to confirm result under controlled conditions',
        })
        .expect(201)

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_oos', recordId: oosId },
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qa,
      )
        .send({ toStateKey: 'phase_2_manufacturing_investigation' })
        .expect(201)

      const afterPhase2 = await authed(
        request(httpServer(app)).get(`/api/v1/quality/oos/${oosId}`),
        qa,
      ).expect(200)
      expect(afterPhase2.body.data.phase2Triggered).toBe(true)
      expect(afterPhase2.body.data.investigationPhase).toBe('phase_2_manufacturing_investigation')

      await authedWrite(request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/phase2`), qa)
        .send({
          findings: 'Manufacturing process deviation confirmed',
          batchImpact: 'batch_rejected',
        })
        .expect(201)

      const batchAfter = await readWithBypass((tx) =>
        tx.batch.findUnique({ where: { id: batchId } }),
      )
      expect(batchAfter?.qualityStatus).toBe('rejected')

      // Pass A2 (item 4c) — a manufacturing investigation cannot complete without its report.
      const closeToken = await signatureTokenFor(qm)
      const noReport = await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken,
          intentStatement: 'Close after Phase 2',
        })
        .expect(409)
      expect(noReport.body.error.message).toContain('manufacturing investigation report')
      await seedDocument(companyId, 'oos_manufacturing_report', oosId)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken,
          intentStatement: 'Close after Phase 2',
        })
        .expect(201)

      const final = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { id: instance.id },
        include: { currentState: true },
      })
      expect(final.currentState.stateKey).toBe('closed')
    })

    it('opens a CAPA against an OOS via its own dedicated endpoint', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/quality/oos'), qa)
        .send({ batchId, specificationId, parameterId, testResult: '95.0% assay' })
        .expect(201)
      const oosId = created.body.data.id as string

      const capa = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/oos/${oosId}/capa`),
        qa,
      )
        .send(
          allocation(qa.userId, {
            rootCause: 'Analyst technique drift on the assay',
            correctiveAction: 'Retrain on assay procedure',
          }),
        )
        .expect(201)
      expect(capa.body.data.sourceRecordType).toBe('oos')
      expect(capa.body.data.sourceRecordId).toBe(oosId)
    })
  })

  describe('Stage 7 — Batch Traceability, Record Review & Disposition', () => {
    it('records a signature-gated disposition and writes it onto Batch.qualityStatus', async () => {
      const qm = await actorWith('QUALITY_MANAGER')

      const review = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/batch-record-reviews'),
        qm,
      )
        .send({ batchId, reviewFindings: 'All in-process checks reviewed and pass' })
        .expect(201)
      const reviewId = review.body.data.id as string
      expect(review.body.data.reviewerUserId).toBe(qm.userId)

      const signatureToken = await signatureTokenFor(qm)
      const dispositioned = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/batch-record-reviews/${reviewId}/disposition`,
        ),
        qm,
      )
        .send({
          disposition: 'released',
          intentStatement: 'I release this batch for distribution',
          signatureToken,
        })
        .expect(201)
      expect(dispositioned.body.data.disposition).toBe('released')
      expect(dispositioned.body.data.dispositionedAt).not.toBeNull()

      const batchAfter = await readWithBypass((tx) =>
        tx.batch.findUnique({ where: { id: batchId } }),
      )
      expect(batchAfter?.qualityStatus).toBe('released')

      // A second disposition attempt is rejected — every review disposition is a one-shot, audited action.
      const secondToken = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/quality/batch-record-reviews/${reviewId}/disposition`,
        ),
        qm,
      )
        .send({ disposition: 'rejected', intentStatement: 'ok', signatureToken: secondToken })
        .expect(409)

      const listed = await authed(
        request(httpServer(app)).get(`/api/v1/quality/batches/${batchId}/record-reviews`),
        qm,
      ).expect(200)
      expect(listed.body.data).toHaveLength(1)
    })

    it('traces real upstream/downstream batch genealogy and every linked quality event', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')

      const upstreamBatchRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/batches'),
        qa,
      )
        .send({
          productId,
          batchNumber: 'API-LOT-2026-01',
          manufacturedOn: '2025-12-01',
          expiresOn: '2027-12-01',
        })
        .expect(201)
      const upstreamBatchId = upstreamBatchRes.body.data.id as string

      await authedWrite(request(httpServer(app)).patch(`/api/v1/batches/${batchId}`), qa)
        .send({ parentBatchIds: [upstreamBatchId, 'external-supplier-lot-9'] })
        .expect(200)

      const downstreamBatchRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/batches'),
        qa,
      )
        .send({
          productId,
          batchNumber: 'B2026-002-REPACK',
          manufacturedOn: '2026-02-01',
          expiresOn: '2028-02-01',
          parentBatchIds: [batchId],
        })
        .expect(201)
      const downstreamBatchId = downstreamBatchRes.body.data.id as string

      // A deviation and an OOS both linked to the traced batch.
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/deviations'), qa)
        .send({
          title: 'Cold-chain excursion',
          sourceType: 'monitoring_alert',
          detectedAt: '2026-02-05',
          batchId,
        })
        .expect(201)
      await authedWrite(request(httpServer(app)).post('/api/v1/quality/oos'), qa)
        .send({ batchId, specificationId, parameterId, testResult: '97.0% assay' })
        .expect(201)

      const trace = await authed(
        request(httpServer(app)).get(`/api/v1/quality/batches/${batchId}/traceability`),
        qa,
      ).expect(200)
      const upstreamBatches = trace.body.data.upstreamBatches as { id: string }[]
      const downstreamBatches = trace.body.data.downstreamBatches as { id: string }[]
      expect(upstreamBatches.map((b) => b.id)).toEqual([upstreamBatchId])
      expect(trace.body.data.unresolvedUpstreamIds).toEqual(['external-supplier-lot-9'])
      expect(downstreamBatches.map((b) => b.id)).toEqual([downstreamBatchId])
      expect(trace.body.data.deviations).toHaveLength(1)
      expect(trace.body.data.oosRecords).toHaveLength(1)
    })
  })
})
