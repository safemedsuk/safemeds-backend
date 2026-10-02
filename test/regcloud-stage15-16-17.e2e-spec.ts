import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { hashToken } from '../src/modules/auth/services/token-hash.util'
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
 * RegCloud (Phase 12) Stages 15–17 — Modular Engagement Model, Reliance
 * Pathways, and Reporting/Dashboards/Regulatory Intelligence. Real HTTP
 * coverage against the running app, reusing the exact same full
 * `reg_registration` workflow fixture `regcloud-stage8-9-10-11.e2e-spec.ts`
 * established (needed here too — Stage 15's own gates sit on the same
 * `completeness_check`/`responding` transitions).
 */
describe('RegCloud Stages 15–17 — Engagement Model / Reliance Pathways / Reporting (e2e)', () => {
  let app: INestApplication
  let admin: TestActor
  let raOfficer: TestActor
  let sysAdmin: TestActor
  let countryId: string
  let authorityId: string
  let secondAuthorityId: string
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

  /** `invitation`/`app_user` both `FORCE ROW LEVEL SECURITY` — a bare `testPrisma` query against them returns zero rows (or 404s a real row) silently without this, per CLAUDE.md's own RLS gotcha. */
  function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
    return testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return fn(tx as unknown as typeof testPrisma)
    })
  }

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya', officialName: 'Republic of Kenya' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' } })
    secondAuthorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({ data: { id: secondAuthorityId, countryId, code: 'NDA', name: 'National Drug Authority (relying market)' } })

    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'RegCloud Stage15-17 Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })

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
      'master_data.manage',
      'master_data.view',
      'documents.manage',
      'company_profile.manage',
      'users.invite',
      'users.manage_roles',
      'reports.view',
      'reports.manage',
    ]) {
      const permissionId = randomUUID()
      await testPrisma.permission.create({ data: { id: permissionId, key, description: 'test fixture' } })
      await testPrisma.rolePermission.create({ data: { roleId: tenantRoleId, permissionId } })
    }
    raOfficer = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

    // `InvitationsService.create()`'s own `assertTenantAdmin()` requires
    // the literal `SYSTEM_ADMINISTRATOR` role key (not just the
    // `users.invite` permission) — a second, real tenant role reusing
    // the exact same permission rows already created above.
    const usersInvitePermission = await testPrisma.permission.findUniqueOrThrow({ where: { key: 'users.invite' } })
    const usersManageRolesPermission = await testPrisma.permission.findUniqueOrThrow({ where: { key: 'users.manage_roles' } })
    const sysAdminRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: sysAdminRoleId, key: 'SYSTEM_ADMINISTRATOR', name: 'System Administrator', description: 'test fixture', isPlatform: false } })
    await testPrisma.rolePermission.create({ data: { roleId: sysAdminRoleId, permissionId: usersInvitePermission.id } })
    await testPrisma.rolePermission.create({ data: { roleId: sysAdminRoleId, permissionId: usersManageRolesPermission.id } })
    sysAdmin = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })

    // The complete real reg_registration workflow — 9 states, 11 transitions.
    const defId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: defId, recordType: 'reg_registration', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    // testing-correction-explanation.md §2.2/§3.1 — `variation_application`/`renewal_requested` are the two fast-forward entry points a variation/renewal dossier lands at, never reached via a seeded transition (only via `RegVariationService.create()`'s own direct `WorkflowInstance` override) — matching `prisma/workflow.seed-data.ts`'s own real 9-state definition, needed here since this file's own new Phase 4B test files a real renewal.
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

  async function activeDeadlineRule(obligationType: string, intervalValue: number, intervalUnit: 'days' | 'months' | 'years', productClass = '*') {
    const rule = await authedWrite(request(httpServer(app)).post('/api/v1/regulatory-config/deadline-rules'), admin)
      .send({ countryId, authorityId, productClass, obligationType, intervalValue, intervalUnit, unverified: false, effectiveFrom: '2026-01-01' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/regulatory-config/deadline-rules/${rule.body.data.id}/activate`), admin).expect(201)
  }

  async function createDossierAndCompile(productClass: string, extra: Record<string, unknown> = {}): Promise<{ dossierId: string; workflowInstanceId: string }> {
    const dossier = await authedWrite(request(httpServer(app)).post('/api/v1/reg-dossiers'), raOfficer).send({ productId, authorityId, productClass, ...extra }).expect(201)
    const dossierId = dossier.body.data.id as string

    const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
    const workflowInstanceId = fetched.body.data.workflowInstanceId as string

    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'compiling' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'completeness_check' }).expect(201)
    return { dossierId, workflowInstanceId }
  }

  async function approveFreshRegistration(registrationNumber: string, expiresOn = '2031-03-01'): Promise<{ dossierId: string; productRegistrationId: string }> {
    const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
    const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
      .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
      .expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
    await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
      .send({
        toStateKey: 'approved',
        payload: {
          registrationNumber,
          issuedOn: '2026-03-01',
          expiresOn,
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

  describe('Stage 15 — Modular Engagement Model', () => {
    it('a dossier with no override resolves the company default', async () => {
      const { dossierId } = await createDossierAndCompile('generic_pharma')
      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(fetched.body.data.effectiveEngagementType).toBe('full_service')
    })

    it("a dossier's own override wins over the company default", async () => {
      const { dossierId } = await createDossierAndCompile('generic_pharma', { engagementType: 'dossier_review_only' })
      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(fetched.body.data.effectiveEngagementType).toBe('dossier_review_only')
    })

    it('the company profile can update its own default engagement type', async () => {
      const updated = await authedWrite(request(httpServer(app)).patch('/api/v1/company'), raOfficer).send({ engagementType: 'client_handles_queries' }).expect(200)
      expect(updated.body.data.engagementType).toBe('client_handles_queries')

      const { dossierId } = await createDossierAndCompile('generic_pharma')
      const fetched = await authed(request(httpServer(app)).get(`/api/v1/reg-dossiers/${dossierId}`), raOfficer).expect(200)
      expect(fetched.body.data.effectiveEngagementType).toBe('client_handles_queries')
    })

    it('blocks dossier_review_only → submitted with no note, then allows it once a note is given', async () => {
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma', { engagementType: 'dossier_review_only' })
      const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
        .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/dossier review only/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'submitted', note: 'The client confirms they dispatched this to PPB on 23 Aug.' })
        .expect(201)
    })

    it('client_handles_queries: respond() accepts a note instead of a file, and blocks resubmitted_for_review with no note', async () => {
      await authedWrite(request(httpServer(app)).patch('/api/v1/company'), raOfficer).send({ engagementType: 'client_handles_queries' }).expect(200)
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
        .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)

      // Stage 5's own guard requires the query's own content to already
      // be logged before `submitted → query_received` is allowed.
      const query = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries`), raOfficer)
        .field('queryText', 'Please clarify the CPP validity period.')
        .field('receivedDate', '2026-04-01')
        .attach('file', Buffer.from('query letter'), { filename: 'query.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'query_received' }).expect(201)

      const noFileNoNote = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.body.data.id}/respond`), raOfficer).expect(400)
      expect(noFileNoNote.body.error.code).toBe('RESPONSE_NOTE_REQUIRED')

      const responded = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.body.data.id}/respond`), raOfficer)
        .field('note', 'The client confirmed the CPP validity directly with the regulator.')
        .field('respondedDate', '2026-04-10')
        .expect(201)
      expect(responded.body.data.responseNote).toBe('The client confirmed the CPP validity directly with the regulator.')
      expect(responded.body.data.responseDocumentId).toBeNull()

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'responding' }).expect(201)

      const blocked = await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'resubmitted_for_review' })
        .expect(409)
      expect(blocked.body.error.message).toMatch(/client handles queries/i)

      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer)
        .send({ toStateKey: 'resubmitted_for_review', note: 'Resubmitting after the client resolved the query directly.' })
        .expect(201)
    })

    it('respond() 400s with no file when the dossier is not engaged as client_handles_queries', async () => {
      const { dossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions`), raOfficer).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
        .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
      const query = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries`), raOfficer)
        .field('queryText', 'x')
        .field('receivedDate', '2026-04-01')
        .attach('file', Buffer.from('query letter'), { filename: 'query.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'query_received' }).expect(201)

      const result = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${dossierId}/queries/${query.body.data.id}/respond`), raOfficer)
        .field('note', 'Trying to skip the file.')
        .field('respondedDate', '2026-04-10')
        .expect(400)
      expect(result.body.error.code).toBe('RESPONSE_DOCUMENT_REQUIRED')
    })

    it('an invitation created with isExternal true produces an external user once accepted', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/invitations'), sysAdmin)
        .send({ email: 'consultant@example.com', roleKeys: ['REGULATORY_AFFAIRS_OFFICER'], isExternal: true })
        .expect(201)
      expect(created.body.data.isExternal).toBe(true)

      // Constructs a known plaintext token via the app's own hashing
      // utility (`hashToken`), matching what `InvitationsService.create()`
      // itself stores — legitimate test-fixture construction, not a
      // security bypass, and avoids needing to intercept the real
      // invitation email to recover a server-generated plaintext.
      const plaintextToken = randomUUID()
      await withBypass((tx) => tx.invitation.update({ where: { id: created.body.data.id }, data: { tokenHash: hashToken(plaintextToken) } }))

      await request(httpServer(app))
        .post(`/api/v1/auth/invitations/${plaintextToken}/accept`)
        .send({ fullName: 'Consultant Person', password: 'Thorough2026Check!' })
        .expect(201)

      const user = await withBypass((tx) => tx.user.findUniqueOrThrow({ where: { email: 'consultant@example.com' } }))
      expect(user.isExternal).toBe(true)
    })

    it('PATCH /users/:id/roles can toggle isExternal after the fact', async () => {
      const updated = await authedWrite(request(httpServer(app)).patch(`/api/v1/users/${raOfficer.userId}/roles`), sysAdmin)
        .send({ roleKeys: ['REGULATORY_AFFAIRS_OFFICER'], isExternal: true })
        .expect(200)
      expect(updated.body.data.isExternal).toBe(true)

      const user = await withBypass((tx) => tx.user.findUniqueOrThrow({ where: { id: raOfficer.userId } }))
      expect(user.isExternal).toBe(true)
    })
  })

  describe('Stage 16 — Reliance Pathways', () => {
    it('creates a reliance application and its real lead dossier, through the exact same dossier mechanics as any other', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'eac_joint_assessment', leadAuthorityId: authorityId, participatingAuthorityIds: [secondAuthorityId], productClass: 'generic_pharma' })
        .expect(201)

      expect(created.body.data.leadDossier.relianceApplicationId).toBe(created.body.data.id)
      const authorityStatuses = created.body.data.authorityStatuses as { isLead: boolean; dossier: { id: string } | null }[]
      expect(authorityStatuses).toHaveLength(2)
      const leadStatus = authorityStatuses.find((s) => s.isLead)
      expect(leadStatus?.dossier).not.toBeNull()
      const participatingStatus = authorityStatuses.find((s) => !s.isLead)
      expect(participatingStatus?.dossier).toBeNull()
    })

    it('starts a dossier for a participating authority, and refuses to start a second one for the same authority', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'who_crp', leadAuthorityId: authorityId, participatingAuthorityIds: [secondAuthorityId], productClass: 'generic_pharma' })
        .expect(201)

      const started = await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/start-dossier`), raOfficer)
        .send({ authorityId: secondAuthorityId, productClass: 'generic_pharma' })
        .expect(201)
      expect(started.body.data.authorityId).toBe(secondAuthorityId)
      expect(started.body.data.relianceApplicationId).toBe(created.body.data.id)

      const again = await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/start-dossier`), raOfficer)
        .send({ authorityId: secondAuthorityId, productClass: 'generic_pharma' })
        .expect(409)
      expect(again.body.error.code).toBe('DOSSIER_ALREADY_STARTED')
    })

    it('refuses to start a dossier for an authority that was never linked to the application', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'zaziboNa', leadAuthorityId: authorityId, productClass: 'generic_pharma' })
        .expect(201)

      const thirdAuthorityId = randomUUID()
      await testPrisma.regulatoryAuthority.create({ data: { id: thirdAuthorityId, countryId, code: 'OTHER', name: 'Some other authority' } })

      const result = await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/start-dossier`), raOfficer)
        .send({ authorityId: thirdAuthorityId, productClass: 'generic_pharma' })
        .expect(409)
      expect(result.body.error.code).toBe('AUTHORITY_NOT_LINKED')
    })

    it('adds a new participating authority after creation, then can start a dossier for it', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'who_crp', leadAuthorityId: authorityId, productClass: 'generic_pharma' })
        .expect(201)

      const withAuthority = await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/authorities`), raOfficer)
        .send({ authorityId: secondAuthorityId })
        .expect(201)
      expect(withAuthority.body.data.participatingAuthorityIds).toContain(secondAuthorityId)

      await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/start-dossier`), raOfficer)
        .send({ authorityId: secondAuthorityId, productClass: 'generic_pharma' })
        .expect(201)
    })

    it('closes a reliance application', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'who_crp', leadAuthorityId: authorityId, productClass: 'generic_pharma' })
        .expect(201)

      const closed = await authedWrite(request(httpServer(app)).post(`/api/v1/reliance-applications/${created.body.data.id}/close`), raOfficer).expect(201)
      expect(closed.body.data.status).toBe('closed')
    })

    it('404s a reliance application belonging to another company', async () => {
      const created = await authedWrite(request(httpServer(app)).post('/api/v1/reliance-applications'), raOfficer)
        .send({ productId, pathwayType: 'who_crp', leadAuthorityId: authorityId, productClass: 'generic_pharma' })
        .expect(201)

      const otherCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: otherCountryId, isoCode: 'UG', name: 'Uganda' } })
      const otherCompanyId = randomUUID()
      await testPrisma.company.create({ data: { id: otherCompanyId, name: 'Other Co', companyType: 'manufacturer', homeCountryId: otherCountryId, status: 'active' } })
      const otherActor = await createAuthenticatedActor(app, testPrisma, { companyId: otherCompanyId, roleKeys: ['REGULATORY_AFFAIRS_OFFICER'] })

      await authed(request(httpServer(app)).get(`/api/v1/reliance-applications/${created.body.data.id}`), otherActor).expect(404)
    })
  })

  describe('Stage 17 — Reporting, Dashboards & Regulatory Intelligence', () => {
    it('the reporting dashboard extends with real, live-computed regulatory counts', async () => {
      await activeDeadlineRule('renewal', 10, 'days')
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-STG17-1')
      expect(productRegistrationId).toBeTruthy()

      const { dossierId: openQueryDossierId, workflowInstanceId } = await createDossierAndCompile('generic_pharma')
      const submission = await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${openQueryDossierId}/submissions`), raOfficer).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${openQueryDossierId}/submissions/${submission.body.data.id}/evidence`), raOfficer)
        .attach('file', Buffer.from('proof'), { filename: 'proof.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'submitted' }).expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/reg-dossiers/${openQueryDossierId}/queries`), raOfficer)
        .field('queryText', 'Open query for the dashboard test.')
        .field('receivedDate', '2026-04-01')
        .attach('file', Buffer.from('query letter'), { filename: 'query.pdf', contentType: 'application/pdf' })
        .expect(201)
      await authedWrite(request(httpServer(app)).post(`/api/v1/workflow/instances/${workflowInstanceId}/transition`), raOfficer).send({ toStateKey: 'query_received' }).expect(201)

      const dashboard = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), raOfficer).expect(200)
      expect(dashboard.body.data.regulatory.registrationsByStatus).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'active', count: 1 })]))
      expect(dashboard.body.data.regulatory.dossiersByStage.length).toBeGreaterThan(0)
      expect(dashboard.body.data.regulatory.upcomingRenewals30d).toBe(1)
      expect(dashboard.body.data.regulatory.upcomingRenewals90d).toBe(1)
      expect(dashboard.body.data.regulatory.openQueries).toBe(1)

      // testing-correction-explanation.md §4.2 — Phase 4B: dossiers by kind, the open-items list, and this month's activity.
      expect(dashboard.body.data.regulatory.dossiersByKindAndStage).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'registration', stage: 'query_received', count: 1 })]),
      )
      // The query's own `receivedDate` (2026-04-01) is real-world months in the past relative to whenever this suite actually runs — a genuine long-open query, not a fabricated one.
      const longOpenQueries = dashboard.body.data.regulatory.openItems.longOpenQueries as { recordType: string; recordId: string; label: string }[]
      expect(longOpenQueries).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordType: 'reg_dossier', recordId: openQueryDossierId })]),
      )
      expect(dashboard.body.data.regulatory.thisMonthActivity.dossiersSubmitted).toBeGreaterThanOrEqual(1)
      expect(dashboard.body.data.regulatory.thisMonthActivity.approvalsReceived).toBeGreaterThanOrEqual(1)
    })

    it('the dashboard surfaces an overdue post-market obligation and an expiring registration with no renewal started, each linkable to its own registration', async () => {
      // Approved with a real expiry only 30 days out — genuinely "expiring soon," and with no renewal filed against it yet.
      const soonExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const { productRegistrationId } = await approveFreshRegistration('PPB-2026-STG17-4', soonExpiry)

      // A real obligation via the real endpoint, due 10 days ago; `create()` always starts a fresh obligation at `pending` regardless of due date (only the daily sweep flips it), so the real `RegPostMarketObligationService.scanAndFlagOverdue()` is invoked directly here — the same real logic the daily BullMQ job runs, not a fabricated end state.
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-post-market-obligations'), raOfficer)
        .send({ productRegistrationId, obligationType: 'annual_report', dueAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() })
        .expect(201)
      const { RegPostMarketObligationService } = await import('../src/modules/regulatory/reg-post-market-obligation.service')
      const { flagged } = await app.get(RegPostMarketObligationService).scanAndFlagOverdue()
      expect(flagged).toBeGreaterThanOrEqual(1)

      const dashboard = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), raOfficer).expect(200)
      const overdue = dashboard.body.data.regulatory.openItems.overduePostMarketObligations as { recordType: string; recordId: string; label: string }[]
      expect(overdue).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordType: 'product_registration', recordId: productRegistrationId })]),
      )
      const expiringNoRenewal = dashboard.body.data.regulatory.openItems.registrationsExpiringSoonWithNoRenewalStarted as {
        recordType: string
        recordId: string
      }[]
      expect(expiringNoRenewal).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordType: 'product_registration', recordId: productRegistrationId })]),
      )

      // Filing a real renewal variation against it removes it from "no renewal started" on the next read.
      await authedWrite(request(httpServer(app)).post('/api/v1/reg-variations'), raOfficer)
        .send({ productRegistrationId, variationType: 'renewal' })
        .expect(201)
      const dashboardAfter = await authed(request(httpServer(app)).get('/api/v1/reporting/dashboard'), raOfficer).expect(200)
      const expiringNoRenewalAfter = dashboardAfter.body.data.regulatory.openItems.registrationsExpiringSoonWithNoRenewalStarted as { recordId: string }[]
      expect(expiringNoRenewalAfter.map((r) => r.recordId)).not.toContain(productRegistrationId)
    })

    it('generates a real portfolio status report, findable via the shared Reports list under moduleKey regcloud', async () => {
      await createDossierAndCompile('generic_pharma')

      const report = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/regulatory/portfolio-status'), raOfficer).expect(201)
      expect(report.body.data.moduleKey).toBe('regcloud')
      expect(report.body.data.reportTypeKey).toBe('reg_portfolio_status')

      const list = await authed(request(httpServer(app)).get('/api/v1/reports?moduleKey=regcloud'), raOfficer).expect(200)
      expect((list.body.data as { id: string }[]).some((r) => r.id === report.body.data.id)).toBe(true)
    })

    it('generates a real upcoming-renewals report honoring an explicit withinDays override', async () => {
      await activeDeadlineRule('renewal', 5, 'days')
      await approveFreshRegistration('PPB-2026-STG17-2')

      const report = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/regulatory/upcoming-renewals'), raOfficer).send({ withinDays: 7 }).expect(201)
      expect(report.body.data.reportTypeKey).toBe('reg_upcoming_renewals')
      expect(report.body.data.title).toContain('within 7 days')
    })

    it('generates a real dossier-turnaround-time report', async () => {
      await approveFreshRegistration('PPB-2026-STG17-3')

      const report = await authedWrite(request(httpServer(app)).post('/api/v1/reporting/regulatory/dossier-turnaround'), raOfficer).expect(201)
      expect(report.body.data.reportTypeKey).toBe('reg_dossier_turnaround')
    })

    it('RBAC — reports.manage is required to generate a RegCloud report', async () => {
      const noPermRole = 'EXECUTIVE_READONLY'
      await testPrisma.role.create({ data: { id: randomUUID(), key: noPermRole, name: 'Read Only', description: 'test fixture', isPlatform: false } })
      const readonlyActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [noPermRole] })

      await authedWrite(request(httpServer(app)).post('/api/v1/reporting/regulatory/portfolio-status'), readonlyActor).expect(403)
    })
  })
})
