import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { SignatureTokenService } from '../src/modules/auth/services/signature-token.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

/**
 * Pass A2 — the real document upload goes to R2, which this Jest harness
 * can't reach (the documented TLS gotcha; see CLAUDE.md). Attachment rules
 * are asserted against a real `Document` row seeded directly, the same way
 * the other skipped R2-upload tests in this repo are covered.
 */
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

/** Pass A2 — the full allocation body every CAPA opener now requires (owner, separate due dates, root cause). */
function allocation(
  ownerUserId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rootCause: 'Driver left the cooler door open during loading',
    rootCauseCategory: 'human_error_training',
    correctiveAction: 'Retrain all drivers on cold-chain SOP',
    ownerUserId,
    correctiveActionDueDate: '2026-12-01',
    ...extra,
  }
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
 * QualCloud (Phase 13) Stages 1 (Document Control), 2 (Deviation &
 * Non-Conformance Management), and 3 (CAPA, unified cross-module) —
 * walked end to end against the real running app. This e2e database is
 * truncated per test and never runs the dev seed, so this file defines
 * its own `quality_controlled_document`/`quality_deviation` workflow
 * fixtures directly, matching every other stage's own established
 * per-file-fixture convention (see `vigicloud-stage8-9.e2e-spec.ts`).
 */
describe('QualCloud Stage 1/2/3 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let qaRoleId: string
  let qmRoleId: string
  let raRoleId: string
  let sopDefinitionId: string
  let sopStateIds: Record<string, string>
  let deviationDefinitionId: string
  let deviationStateIds: Record<string, string>

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
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'QualCloud Stage 1-2-3 Test Co',
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
      'quality.manage_documents',
      'quality.view_all',
    ])
    await seedRoleWithPermissions(qmRoleId, 'QUALITY_MANAGER', [
      'quality.log_deviation',
      'quality.close_capa',
      'quality.manage_capa',
      'quality.manage_documents',
      'quality.view_all',
      'signatures.read',
    ])
    await seedRoleWithPermissions(raRoleId, 'REGULATORY_AFFAIRS_OFFICER', [
      'regulatory.manage_registrations',
    ])

    // ── quality_controlled_document workflow fixture ──────────────────
    sopDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({
      data: {
        id: sopDefinitionId,
        recordType: 'quality_controlled_document',
        reportTypeId: null,
        countryId: null,
        version: 1,
        status: 'active',
      },
    })
    const sopStateKeys = [
      'draft',
      'in_review',
      'approved',
      'effective',
      'superseded',
      'retired',
    ] as const
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
        {
          id: randomUUID(),
          definitionId: sopDefinitionId,
          fromStateId: sopStateIds.draft,
          toStateId: sopStateIds.in_review,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: sopDefinitionId,
          fromStateId: sopStateIds.in_review,
          toStateId: sopStateIds.draft,
          requiredRoleId: qmRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: sopDefinitionId,
          fromStateId: sopStateIds.in_review,
          toStateId: sopStateIds.approved,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
        {
          id: randomUUID(),
          definitionId: sopDefinitionId,
          fromStateId: sopStateIds.approved,
          toStateId: sopStateIds.effective,
          requiredRoleId: qmRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: sopDefinitionId,
          fromStateId: sopStateIds.effective,
          toStateId: sopStateIds.retired,
          requiredRoleId: qmRoleId,
          requiresSignature: false,
        },
      ],
    })

    // ── quality_deviation workflow fixture ─────────────────────────────
    deviationDefinitionId = randomUUID()
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
    const deviationStateKeys = [
      'detected',
      'classifying',
      'investigating',
      'capa_pending',
      'closed',
    ] as const
    deviationStateIds = {}
    for (const key of deviationStateKeys) deviationStateIds[key] = randomUUID()
    await testPrisma.workflowState.createMany({
      data: deviationStateKeys.map((key) => ({
        id: deviationStateIds[key],
        definitionId: deviationDefinitionId,
        stateKey: key,
        name: key,
        isInitial: key === 'detected',
        isTerminal: key === 'closed',
      })),
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        {
          id: randomUUID(),
          definitionId: deviationDefinitionId,
          fromStateId: deviationStateIds.detected,
          toStateId: deviationStateIds.classifying,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: deviationDefinitionId,
          fromStateId: deviationStateIds.classifying,
          toStateId: deviationStateIds.investigating,
          requiredRoleId: qaRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: deviationDefinitionId,
          fromStateId: deviationStateIds.investigating,
          toStateId: deviationStateIds.capa_pending,
          requiredRoleId: qmRoleId,
          requiresSignature: false,
        },
        {
          id: randomUUID(),
          definitionId: deviationDefinitionId,
          fromStateId: deviationStateIds.capa_pending,
          toStateId: deviationStateIds.closed,
          requiredRoleId: qmRoleId,
          requiresSignature: true,
        },
      ],
    })
  })

  async function actorWith(roleKey: string): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  async function signatureTokenFor(actor: TestActor): Promise<string> {
    const signatureTokenService = app.get(SignatureTokenService)
    return signatureTokenService.issue(actor.userId)
  }

  describe('Stage 1 — Document Control', () => {
    it('walks Draft → In Review → Approved (blocked on self-approval, then signed by a different approver) → Effective, and enforces the retire-reason guard', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const approver = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        author,
      )
        .send({ title: 'Deviation Handling', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      expect(created.body.data.status).toBe('draft')

      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        author,
      )
        .send({ toStateKey: 'in_review' })
        .expect(201)

      // Self-approval blocked, even for QUALITY_MANAGER, since the author is the actor.
      const authorAsManager = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['QUALITY_MANAGER'],
      })
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        // Force this second actor to literally be the same person who created the document,
        // by re-pointing the Sop's own createdBy at them for this one check.
        await tx.sop.update({ where: { id: sopId }, data: { createdBy: authorAsManager.userId } })
      })
      const selfApproveToken = await signatureTokenFor(authorAsManager)
      const blocked = await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        authorAsManager,
      )
        .send({
          toStateKey: 'approved',
          signatureToken: selfApproveToken,
          intentStatement: 'I approve this document',
        })
        .expect(409)
      expect(blocked.body.error.message).toContain('own author')

      // Restore the real author, then a genuinely different QUALITY_MANAGER approves.
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.sop.update({ where: { id: sopId }, data: { createdBy: author.userId } })
      })
      const approveToken = await signatureTokenFor(approver)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({
          toStateKey: 'approved',
          signatureToken: approveToken,
          intentStatement: 'I approve this document',
        })
        .expect(201)

      const signatures = await authed(
        request(httpServer(app)).get(
          `/api/v1/records/quality_controlled_document/${sopId}/signatures`,
        ),
        approver,
      ).expect(200)
      expect(signatures.body.data[0]).toMatchObject({ roleAtSigning: 'QUALITY_MANAGER' })

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'effective' })
        .expect(201)
      const afterEffectiveInstance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { id: instance.id },
        include: { currentState: true },
      })
      expect(afterEffectiveInstance.currentState.stateKey).toBe('effective')

      const afterEffective = await authed(
        request(httpServer(app)).get(`/api/v1/quality/sops/${sopId}`),
        approver,
      ).expect(200)
      expect(afterEffective.body.data.status).toBe('effective')
      expect(afterEffective.body.data.effectiveDate).not.toBeNull()

      // Retire requires a reason.
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'retired' })
        .expect(409)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'retired', note: 'Superseded by a new regulatory requirement' })
        .expect(201)
    })

    it('revise() opens a new draft v2 referencing the effective v1, and going v2 effective supersedes v1', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const approver = await actorWith('QUALITY_MANAGER')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        author,
      )
        .send({ title: 'Batch Release', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        author,
      )
        .send({ toStateKey: 'in_review' })
        .expect(201)
      const approveToken = await signatureTokenFor(approver)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'approved', signatureToken: approveToken, intentStatement: 'approve' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'effective' })
        .expect(201)

      const revised = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/sops/${sopId}/revise`),
        author,
      ).expect(201)
      expect(revised.body.data.currentVersion).toBe(2)
      expect(revised.body.data.supersedesDocumentId).toBe(sopId)
      expect(revised.body.data.status).toBe('draft')

      const v2Instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: revised.body.data.id },
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${v2Instance.id}/transition`),
        author,
      )
        .send({ toStateKey: 'in_review' })
        .expect(201)
      const approveToken2 = await signatureTokenFor(approver)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${v2Instance.id}/transition`),
        approver,
      )
        .send({
          toStateKey: 'approved',
          signatureToken: approveToken2,
          intentStatement: 'approve v2',
        })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${v2Instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'effective' })
        .expect(201)

      const v1AfterSupersede = await authed(
        request(httpServer(app)).get(`/api/v1/quality/sops/${sopId}`),
        approver,
      ).expect(200)
      expect(v1AfterSupersede.body.data.status).toBe('superseded')
    })

    it('assign readers and acknowledge — real read-and-understand tracking', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const approver = await actorWith('QUALITY_MANAGER')
      const reader = await actorWith('QUALITY_ASSOCIATE')

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        author,
      )
        .send({ title: 'Complaint Handling', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        author,
      )
        .send({ toStateKey: 'in_review' })
        .expect(201)
      const approveToken = await signatureTokenFor(approver)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'approved', signatureToken: approveToken, intentStatement: 'approve' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'effective' })
        .expect(201)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/sops/${sopId}/acknowledgments/assign`),
        approver,
      )
        .send({ userIds: [reader.userId] })
        .expect(201)

      const before = await authed(
        request(httpServer(app)).get(`/api/v1/quality/sops/${sopId}/acknowledgments`),
        approver,
      ).expect(200)
      expect(before.body.data[0].acknowledgedAt).toBeNull()

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/sops/${sopId}/acknowledgments/acknowledge`),
        reader,
      ).expect(201)

      const after = await authed(
        request(httpServer(app)).get(`/api/v1/quality/sops/${sopId}/acknowledgments`),
        approver,
      ).expect(200)
      expect(after.body.data[0].acknowledgedAt).not.toBeNull()
    })
  })

  describe('Stage 2 — Deviation & Non-Conformance Management', () => {
    async function createDeviation(actor: TestActor) {
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/deviations'),
        actor,
      )
        .send({
          title: 'Temperature excursion during transport',
          sourceType: 'monitoring_alert',
          detectedAt: '2026-09-01',
          description: 'Cold-chain logger showed 12°C for two hours',
        })
        .expect(201)
      const deviationId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_deviation', recordId: deviationId },
      })
      return { deviationId, instanceId: instance.id, body: created.body.data }
    }

    it('requires a real severity to classify, computes investigationDueAt, and decrypts the description on read', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const { deviationId, instanceId, body } = await createDeviation(qa)
      expect(body.description).toBe('Cold-chain logger showed 12°C for two hours')

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'classifying' })
        .expect(409)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'classifying', payload: { severity: 'major' } })
        .expect(201)

      const afterClassify = await authed(
        request(httpServer(app)).get(`/api/v1/quality/deviations/${deviationId}`),
        qa,
      ).expect(200)
      expect(afterClassify.body.data.severity).toBe('major')
      expect(afterClassify.body.data.investigationDueAt).not.toBeNull()
      const due = new Date(afterClassify.body.data.investigationDueAt as string)
      const detected = new Date('2026-09-01T00:00:00.000Z')
      expect(due.getTime() - detected.getTime()).toBe(30 * 24 * 60 * 60 * 1000)
    })

    it('four-eyes: the investigator cannot also move the deviation to CAPA Pending, but a different reviewer can', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')
      const { deviationId, instanceId } = await createDeviation(qa)
      await seedDocument(companyId, 'deviation_investigation_report', deviationId)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'classifying', payload: { severity: 'minor' } })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'investigating' })
        .expect(201)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/deviations/${deviationId}/investigation`),
        qa,
      )
        .send({
          rootCauseMethod: 'five_why',
          findings: 'Driver left the cooler door open',
          investigatorUserId: qa.userId,
        })
        .expect(201)

      // qa is the investigator — even with QUALITY_MANAGER's own role, they can't review their own investigation.
      const qaAsManager = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['QUALITY_MANAGER'],
      })
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.investigation.update({
          where: { deviationId },
          data: { investigatorUserId: qaAsManager.userId },
        })
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qaAsManager,
      )
        .send({ toStateKey: 'capa_pending' })
        .expect(409)

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qm,
      )
        .send({ toStateKey: 'capa_pending' })
        .expect(201)
    })

    it('cannot close without a CAPA, opens one via the deviation-scoped endpoint, then closes signed', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')
      const { deviationId, instanceId } = await createDeviation(qa)
      await seedDocument(companyId, 'deviation_investigation_report', deviationId)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'classifying', payload: { severity: 'minor' } })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qa,
      )
        .send({ toStateKey: 'investigating' })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qm,
      )
        .send({ toStateKey: 'capa_pending' })
        .expect(201)

      const closeToken = await signatureTokenFor(qm)
      const blocked = await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken,
          intentStatement: 'close deviation',
        })
        .expect(409)
      expect(blocked.body.error.message).toContain('needs a CAPA')

      const capa = await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/deviations/${deviationId}/capa`),
        qa,
      )
        .send(allocation(qa.userId))
        .expect(201)
      expect(capa.body.data.sourceRecordType).toBe('deviation')
      expect(capa.body.data.ownerUserId).toBe(qa.userId)
      expect(capa.body.data.title).toBe('Driver left the cooler door open during loading')
      expect(capa.body.data.sourceRecordId).toBe(deviationId)

      // Real Stage 3 lifecycle on this exact CAPA before it can close.
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capa.body.data.id}/approve`),
        qm,
      )
        .send({})
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capa.body.data.id}/implement`),
        qa,
      ).expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capa.body.data.id}/effectiveness-check`),
        qm,
      )
        .send({ result: 'effective' })
        .expect(201)
      await seedDocument(companyId, 'capa', capa.body.data.id as string)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capa.body.data.id}/close`),
        qm,
      ).expect(201)

      const closeToken2 = await signatureTokenFor(qm)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instanceId}/transition`),
        qm,
      )
        .send({
          toStateKey: 'closed',
          signatureToken: closeToken2,
          intentStatement: 'close deviation',
        })
        .expect(201)
      const afterCloseInstance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { id: instanceId },
        include: { currentState: true },
      })
      expect(afterCloseInstance.currentState.stateKey).toBe('closed')

      const afterClose = await authed(
        request(httpServer(app)).get(`/api/v1/quality/deviations/${deviationId}`),
        qm,
      ).expect(200)
      expect(afterClose.body.data.status).toBe('closed')
      expect(afterClose.body.data.closedAt).not.toBeNull()
    })
  })

  describe('Stage 3 — CAPA, cross-functional sign-off and regulatory approval gate', () => {
    it('assignAction() refines correction/correctiveAction/preventiveAction independently', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), qa)
        .send(
          allocation(qa.userId, {
            rootCause: 'Labels swapped at the packing line',
            correctiveAction: 'Relabel affected stock',
          }),
        )
        .expect(201)
      const updated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${created.body.data.id}/action`),
        qa,
      )
        .send({
          correction: 'Quarantine mislabeled units immediately',
          preventiveAction: 'Add a second label check step',
        })
        .expect(201)
      expect(updated.body.data.correction).toBe('Quarantine mislabeled units immediately')
      expect(updated.body.data.preventiveAction).toBe('Add a second label check step')
      expect(updated.body.data.correctiveAction).toBe('Relabel affected stock')
    })

    it('blocks implement() before approve(), and blocks close() on a required-but-missing regulatory approval', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')
      const ra = await actorWith('REGULATORY_AFFAIRS_OFFICER')

      const created = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), qa)
        .send(
          allocation(qa.userId, {
            rootCause: 'Filed variation was out of date',
            correctiveAction: 'Submit a variation',
            requiresRegulatoryApproval: true,
            regulatoryApproverUserId: ra.userId,
          }),
        )
        .expect(201)
      const capaId = created.body.data.id as string

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/implement`),
        qa,
      ).expect(409)

      await authedWrite(request(httpServer(app)).post(`/api/v1/capas/${capaId}/approve`), qm)
        .send({ requiresRegulatoryApproval: true })
        .expect(201)
      await seedDocument(companyId, 'capa', capaId)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/implement`),
        qa,
      ).expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/effectiveness-check`),
        qm,
      )
        .send({ result: 'effective' })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`), qm).expect(
        409,
      )

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/regulatory-approve`),
        ra,
      ).expect(201)
      const closed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`),
        qm,
      ).expect(201)
      expect(closed.body.data.status).toBe('closed')
    })

    it('flags a prior effective CAPA as recurring when a new one shares its root-cause category within 12 months', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE')
      const qm = await actorWith('QUALITY_MANAGER')

      const first = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), qa)
        .send(
          allocation(qa.userId, {
            rootCause: 'First occurrence',
            rootCauseCategory: 'equipment_calibration',
          }),
        )
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${first.body.data.id}/effectiveness-check`),
        qm,
      )
        .send({ result: 'effective' })
        .expect(201)
      await seedDocument(companyId, 'capa', first.body.data.id as string)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${first.body.data.id}/close`),
        qm,
      ).expect(201)

      await authedWrite(request(httpServer(app)).post('/api/v1/capas'), qa)
        .send(
          allocation(qa.userId, {
            rootCause: 'Second occurrence',
            rootCauseCategory: 'equipment_calibration',
          }),
        )
        .expect(201)

      const refreshedFirst = await authed(
        request(httpServer(app)).get(`/api/v1/capas/${first.body.data.id}`),
        qm,
      ).expect(200)
      expect(refreshedFirst.body.data.flaggedRecurring).toBe(true)
    })
  })

  describe('Pass A — controlled-document reader assignment, second-user loading, audit trail', () => {
    it('a QUALITY_ASSOCIATE without users.view can open the document and assign readers in review; the reader list never needs GET /users', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const reviewer = await actorWith('QUALITY_ASSOCIATE')

      // Root cause of the "loads forever" report: GET /users is gated
      // users.view, which this role does not hold — so the old single
      // Promise.all detail load could never complete for this user.
      await authed(request(httpServer(app)).get('/api/v1/users'), reviewer).expect(403)

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        author,
      )
        .send({ title: 'Reader Assignment', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        author,
      )
        .send({ toStateKey: 'in_review' })
        .expect(201)

      // The second user opens the document — the document detail endpoint
      // must succeed for them (view_all), and the reader picker must work
      // without users.view.
      const detail = await authed(
        request(httpServer(app)).get(`/api/v1/quality/sops/${sopId}`),
        reviewer,
      ).expect(200)
      expect(detail.body.data.status).toBe('in_review')
      const readers = await authed(
        request(httpServer(app)).get('/api/v1/quality/sops/assignable-readers'),
        reviewer,
      ).expect(200)
      expect(Array.isArray(readers.body.data)).toBe(true)
      expect(readers.body.data[0]).toEqual(
        expect.objectContaining({ id: expect.any(String), fullName: expect.any(String) }),
      )
      expect(readers.body.data[0]).not.toHaveProperty('roleKeys')

      // Readers can be pre-assigned in review…
      const readerId = reviewer.userId
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/sops/${sopId}/acknowledgments/assign`),
        reviewer,
      )
        .send({ userIds: [readerId] })
        .expect(201)
      // …but cannot acknowledge until the document is effective.
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/quality/sops/${sopId}/acknowledgments/acknowledge`),
        reviewer,
      ).expect(409)

      const audit = await testPrisma.auditEntry.findFirst({
        where: {
          companyId,
          recordType: 'sop',
          recordId: sopId,
          action: 'document_readers_assigned',
        },
      })
      expect(audit).not.toBeNull()
      const createdAudit = await testPrisma.auditEntry.findFirst({
        where: { companyId, recordType: 'sop', recordId: sopId, action: 'sop_created' },
      })
      expect(createdAudit).not.toBeNull()
      expect((createdAudit!.newValue as Record<string, unknown>).documentNumber).toEqual(
        expect.stringMatching(/-SOP-\d{4}-\d{4}$/),
      )
    })

    it('a retire without a reason is refused; a retire with a reason is recorded in the audit trail against the transition', async () => {
      const author = await actorWith('QUALITY_ASSOCIATE')
      const approver = await actorWith('QUALITY_MANAGER')
      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/quality/sops'),
        author,
      )
        .send({ title: 'Retire Reason', documentType: 'sop' })
        .expect(201)
      const sopId = created.body.data.id as string
      const instance = await testPrisma.workflowInstance.findFirstOrThrow({
        where: { recordType: 'quality_controlled_document', recordId: sopId },
      })
      // Drive the row + workflow state directly (bypass RLS for this test-only
      // fixture write), since reaching `effective` needs the full sign-off chain.
      await testPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
        await tx.sop.update({ where: { id: sopId }, data: { status: 'effective' } })
        await tx.workflowInstance.update({
          where: { id: instance.id },
          data: { currentStateId: sopStateIds.effective },
        })
      })

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'retired' })
        .expect(409)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/workflow/instances/${instance.id}/transition`),
        approver,
      )
        .send({ toStateKey: 'retired', note: 'Superseded by SOP-QA-014' })
        .expect(201)

      // The generic engine writes a `state_change` entry against the record
      // itself (recordType/recordId), with the transition note in newValue.
      const transitionAudit = await testPrisma.auditEntry.findFirst({
        where: {
          companyId,
          recordType: 'quality_controlled_document',
          recordId: sopId,
          action: 'state_change',
        },
        orderBy: { occurredAt: 'desc' },
      })
      expect(JSON.stringify(transitionAudit?.newValue ?? {})).toContain('Superseded by SOP-QA-014')
    })
  })
})
