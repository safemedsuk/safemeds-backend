import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { StorageService } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/** Same in-memory stand-in `regcloud-stage0.e2e-spec.ts` uses — real R2 hits the known Jest/TLS gotcha (CLAUDE.md), unrelated to anything this spec tests. */
class FakeStorageService {
  putObject(key: string, body: Buffer): Promise<{ key: string; sha256: string; sizeBytes: number }> {
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }
}

/**
 * RegCloud (Phase 12) Stages 1–3 — Classify & Plan, Compile Dossier, and
 * the flagship Completeness & Format Check gate, exercised end-to-end
 * against the real running app. All three stages landed inside
 * `RegDossierService`/`RegConfigService`/the new `ClassificationService`/
 * `CompletenessGateService`/`RegWorkflowGuards` — no new tables — so this
 * suite focuses on the real workflow lifecycle (`planning` →
 * `compiling` → `completeness_check`) rather than schema mechanics
 * already covered by `regcloud-stage0.e2e-spec.ts`.
 */
describe('RegCloud Stages 1–3 — Classify & Plan / Compile Dossier / Completeness Gate (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let raOfficer: TestActor
  let countryId: string
  let authorityId: string
  let companyId: string
  let productId: string
  let tenantRoleId: string

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
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })

    companyId = randomUUID()
    await testPrisma.company.create({
      data: { id: companyId, name: 'RegCloud Stage1-3 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' },
    })

    const platformRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: platformRoleId, key: 'super_admin', name: 'Platform Super Admin', description: 'test fixture', isPlatform: true } })
    const platformPermissionId = randomUUID()
    await testPrisma.permission.create({ data: { id: platformPermissionId, key: 'platform.config.manage', description: 'test fixture' } })
    await testPrisma.rolePermission.create({ data: { roleId: platformRoleId, permissionId: platformPermissionId } })
    admin = await createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })

    tenantRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: tenantRoleId, key: 'REGULATORY_AFFAIRS_OFFICER', name: 'RA Officer', description: 'test fixture', isPlatform: false } })
    for (const key of ['regulatory.manage_dossier', 'regulatory.view_all', 'master_data.manage', 'master_data.view', 'documents.manage']) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // The real reg_registration workflow: planning → compiling → completeness_check.
    const regDefinitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: regDefinitionId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const planningStateId = randomUUID()
    const compilingStateId = randomUUID()
    const completenessCheckStateId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: planningStateId, definitionId: regDefinitionId, stateKey: 'planning', name: 'Planning', isInitial: true, isTerminal: false },
        { id: compilingStateId, definitionId: regDefinitionId, stateKey: 'compiling', name: 'Compiling Dossier', isInitial: false, isTerminal: false },
        { id: completenessCheckStateId, definitionId: regDefinitionId, stateKey: 'completeness_check', name: 'Completeness Check', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.createMany({
      data: [
        { id: randomUUID(), definitionId: regDefinitionId, fromStateId: planningStateId, toStateId: compilingStateId, requiredRoleId: tenantRoleId, requiresSignature: false },
        { id: randomUUID(), definitionId: regDefinitionId, fromStateId: compilingStateId, toStateId: completenessCheckStateId, requiredRoleId: tenantRoleId, requiresSignature: false },
      ],
    })

    const product = await authedWrite(request(httpServer(app)).post('/api/v1/products'), raOfficer)
      .send({ brandName: 'Amoxiclav', genericName: 'Amoxicillin/Clavulanate', productCategory: 'medicinal', dosageForm: 'tablet', strength: '500mg' })
      .expect(201)
    productId = product.body.data.id as string
  })

  async function activeRequirement(productClass: string, documentDefinitions: { documentKey: string; name: string; isMandatory?: boolean }[]) {
    const req = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
      .send({ countryId, authorityId, productClass, effectiveFrom: '2026-01-01', unverified: false, documentDefinitions })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${req.body.data.id}/activate`), admin).expect(201)
    return req.body.data.id as string
  }

  describe('Stage 1 — Classify & Plan', () => {
    it('classify() previews the resolved checklist/fee/timeline without creating anything', async () => {
      await activeRequirement('generic_pharma', [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }])
      const fee = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/fee-schedules'), admin)
        .send({ countryId, authorityId, productClass: 'generic_pharma', feeType: 'application', amount: '5000.00', unverified: false, effectiveFrom: '2026-01-01' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/fee-schedules/${fee.body.data.id}/activate`), admin).expect(201)

      const preview = await authed(
        request(httpServer(app)).get(`/api/v1/reg-dossiers/classify?authorityId=${authorityId}&productClass=generic_pharma`),
        raOfficer,
      ).expect(200)

      expect(preview.body.data.requirement.documentDefinitions).toHaveLength(1)
      expect(preview.body.data.feeSchedules).toEqual([expect.objectContaining({ amount: '5000', feeType: 'application' })]);
      expect(preview.body.data.warnings).toEqual([]);

      // A pure read — no dossier was actually created by previewing.
      const dossiers = await authed(request(httpServer(app)).get('/api/v1/reg-dossiers'), raOfficer).expect(200)
      expect(dossiers.body.data).toEqual([])
    })

    it('classify() warns honestly when nothing is configured for this combination yet', async () => {
      const preview = await authed(
        request(httpServer(app)).get(`/api/v1/reg-dossiers/classify?authorityId=${authorityId}&productClass=unconfigured_class`),
        raOfficer,
      ).expect(200)

      expect(preview.body.data.requirement).toBeNull()
      expect(preview.body.data.warnings[0]).toMatch(/no document checklist is configured/i)
    })

    it('creating a dossier instantiates a real reg_registration workflow starting at "planning"', async () => {
      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossier.body.data.id}`), raOfficer).expect(200)
      expect(fetched.body.data.status).toBe('planning')
      expect(fetched.body.data.workflowInstanceId).toBeTruthy()
      expect(fetched.body.data.completeness).toEqual({ allowed: true, guidanceOnly: false, slots: [] })
    })
  })

  describe('Stage 2 — Compile Dossier', () => {
    it('a dossier progresses from planning into compiling, and documents attach through the existing upload+attach mechanics', async () => {
      await activeRequirement('generic_pharma', [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }])
      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      const dossierId = dossier.body.data.id as string
      const slotId = dossier.body.data.documentSlots[0].id as string

      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      const workflowInstanceId = fetched.body.data.workflowInstanceId as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'compiling' })
        .expect(201)

      const uploadRes = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), raOfficer)
        .field('title', 'CPP scan')
        .attach('file', Buffer.from('%PDF-1.4 fake cpp scan'), { filename: 'cpp.pdf', contentType: 'application/pdf' })
        .expect(201)
      const documentId = uploadRes.body.data.document.id as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slotId}/attach`), raOfficer)
        .send({ documentId })
        .expect(201)

      const afterAttach = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(afterAttach.body.data.status).toBe('compiling')
      expect(afterAttach.body.data.completeness).toEqual({
        allowed: true,
        guidanceOnly: false,
        slots: [{ slotId, label: 'Certificate of Pharmaceutical Product', ctdModule: null, isMandatory: true, attached: true, met: true }],
      })
    })
  })

  describe('Stage 3 — Completeness & Format Check (the flagship gate)', () => {
    it('blocks compiling → completeness_check with a real, named reason until every mandatory document is attached, then allows it', async () => {
      await activeRequirement('generic_pharma', [
        { documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' },
        { documentKey: 'gmp_certificate', name: 'GMP Certificate' },
      ])
      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      const dossierId = dossier.body.data.id as string
      const slots = dossier.body.data.documentSlots as { id: string }[]

      const initial = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      const workflowInstanceId = initial.body.data.workflowInstanceId as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'compiling' })
        .expect(201)

      // Neither mandatory document is attached yet — the gate must refuse with a real, named reason.
      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'completeness_check' })
        .expect(409)
      expect(blocked.body.error.message).toContain('Certificate of Pharmaceutical Product')
      expect(blocked.body.error.message).toContain('GMP Certificate')

      // Attach one of the two — still blocked, and the reason now names only the remaining one.
      const upload1 = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), raOfficer)
        .field('title', 'CPP scan')
        .attach('file', Buffer.from('%PDF-1.4 fake cpp'), { filename: 'cpp.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slots[0].id}/attach`), raOfficer)
        .send({ documentId: upload1.body.data.document.id })
        .expect(201)

      const stillBlocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'completeness_check' })
        .expect(409)
      expect(stillBlocked.body.error.message).toContain('GMP Certificate')
      expect(stillBlocked.body.error.message).not.toContain('Certificate of Pharmaceutical Product')

      // Attach the second — the gate now allows the transition through.
      const upload2 = await authedWrite(request(httpServer(app)).post(`/api/v1/records/reg_dossier/${dossierId}/documents/upload`), raOfficer)
        .field('title', 'GMP scan')
        .attach('file', Buffer.from('%PDF-1.4 fake gmp'), { filename: 'gmp.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots/${slots[1].id}/attach`), raOfficer)
        .send({ documentId: upload2.body.data.document.id })
        .expect(201)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'completeness_check' })
        .expect(201)

      const finalState = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(finalState.body.data.status).toBe('completeness_check')
      expect(finalState.body.data.completeness.allowed).toBe(true)
      // The Decision History timeline reads real transitions back from the
      // audit trail, newest first (`AuditService.query()`'s own ordering).
      expect(finalState.body.data.transitionHistory).toEqual([
        expect.objectContaining({ fromStateKey: 'compiling', toStateKey: 'completeness_check' }),
        expect.objectContaining({ fromStateKey: 'planning', toStateKey: 'compiling' }),
      ])
    })

    it('a zero-slot dossier (unconfigured market) never blocks — the gate is generous by construction', async () => {
      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'unconfigured_class' })
        .expect(201)
      const dossierId = dossier.body.data.id as string

      const initial = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      const workflowInstanceId = initial.body.data.workflowInstanceId as string

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'compiling' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'completeness_check' })
        .expect(201)

      const finalState = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(finalState.body.data.status).toBe('completeness_check')
    })

    it('a non-mandatory checklist item never blocks the gate even without a document attached', async () => {
      const req = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/requirements'), admin)
        .send({
          countryId,
          authorityId,
          productClass: 'generic_pharma',
          effectiveFrom: '2026-01-01',
          unverified: false,
          documentDefinitions: [{ documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' }],
        })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/requirements/${req.body.data.id}/activate`), admin).expect(201)

      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      const dossierId = dossier.body.data.id as string

      // An ad-hoc slot (no `RequiredDocumentDefinition` behind it) — never mandatory by construction.
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/slots`), raOfficer)
        .send({ labelOverride: 'Optional supplementary annex' })
        .expect(201)

      const completeness = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}/completeness`), raOfficer).expect(200)
      // The real CPP checklist slot is still unmet (never attached) — the gate is honest about that —
      // but the ad-hoc slot never contributes to `allowed` either way.
      const slots = completeness.body.data.slots as { label: string; isMandatory: boolean; met: boolean }[]
      const adHocSlot = slots.find((s) => s.label === 'Optional supplementary annex')
      expect(adHocSlot).toMatchObject({ isMandatory: false, met: true })
    })
  })

  describe('RBAC — role gating on the reg_registration workflow', () => {
    it('a role with no dossier-management remit cannot transition the workflow', async () => {
      // No permissions granted at all — this role's own workflow-role
      // exclusion is what's under test, not a controller-level permission
      // gate (`POST /workflow/instances/:id/transition` has none, per
      // `WorkflowController`'s own doc comment — the role check is purely
      // inside `WorkflowService.transition()` itself).
      const otherRoleId = randomUUID()
      await testPrisma.role.create({ data: { id: otherRoleId, key: 'EXECUTIVE_READONLY', name: 'Executive Readonly', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })

      const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer)
        .send({ productId, authorityId, productClass: 'generic_pharma' })
        .expect(201)
      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossier.body.data.id}`), raOfficer).expect(200)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${fetched.body.data.workflowInstanceId}/transition`), readonlyActor)
        .send({ toStateKey: 'compiling' })
        .expect(403)
    })
  })
})
