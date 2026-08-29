import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { StorageService } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * testing-todo 15's own real-R2-in-Jest TLS gotcha applies to the new
 * emblem-upload endpoint too — `.env.test`'s `R2_ENDPOINT` is a
 * deliberate placeholder. In-memory stand-in, matching every other
 * e2e spec's own local `FakeStorageService` precedent.
 */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>()

  putObject(
    key: string,
    body: Buffer,
  ): Promise<{ key: string; sha256: string; sizeBytes: number }> {
    this.objects.set(key, body)
    return Promise.resolve({
      key,
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: body.byteLength,
    })
  }

  getObjectBuffer(key: string): Promise<Buffer> {
    const body = this.objects.get(key)
    if (!body) return Promise.reject(new Error('NoSuchKey'))
    return Promise.resolve(body)
  }
}

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

async function seedPermission(key: string): Promise<void> {
  await testPrisma.permission.upsert({
    where: { key },
    update: {},
    create: { id: randomUUID(), key, description: 'e2e fixture' },
  })
}

async function seedRole(
  roleKey: string,
  permissionKeys: string[],
  isPlatform = true,
): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: {
      id: randomUUID(),
      key: roleKey,
      name: roleKey,
      description: 'e2e fixture',
      isPlatform,
    },
  })
  for (const key of permissionKeys) {
    const permission = await testPrisma.permission.upsert({
      where: { key },
      update: {},
      create: { id: randomUUID(), key, description: 'e2e fixture' },
    })
    await testPrisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
}

/**
 * Admin Configuration Console — the four gaps closed in this pass:
 * `ReportingRule`'s missing `submissionDestination`/`sourceReference`
 * fields (Gap 1), `RegulatoryAuthority` CRUD (Gap 2),
 * `AuditRequirementDefinition` admin editing (Gap 3), and the RBAC
 * write path (Gap 4). Every write endpoint here is platform-gated
 * (`platform.config.manage`/`platform.rbac.manage`), since none of
 * this domain carries a `companyId` — it's shared across every tenant.
 */
describe('Admin Configuration Console (e2e)', () => {
  let app: INestApplication
  let countryId: string
  let authorityId: string
  let reportTypeId: string

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(StorageService).useValue(new FakeStorageService()),
    )
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'UG', name: 'Uganda' } })
    authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'NDA', name: 'National Drug Authority' },
    })
    reportTypeId = randomUUID()
    await testPrisma.reportType.create({
      data: { id: reportTypeId, typeKey: `adr_e2e_${randomUUID()}`, name: 'Suspected ADR' },
    })
  })

  async function configManager(): Promise<TestActor> {
    await seedRole('regulatory_lead', ['platform.config.manage'])
    return createAuthenticatedActor(app, testPrisma, { platformRole: 'regulatory_lead' })
  }

  async function rbacManager(): Promise<TestActor> {
    await seedRole('super_admin', ['platform.rbac.manage'])
    return createAuthenticatedActor(app, testPrisma, { platformRole: 'super_admin' })
  }

  async function noPermsActor(): Promise<TestActor> {
    return createAuthenticatedActor(app, testPrisma, { platformRole: 'support' })
  }

  // ── Gap 1 — ReportingRule's submissionDestination/sourceReference ──────

  describe('ReportingRule new fields', () => {
    it('createReportingRuleVersion carries submissionDestination and sourceReference through to the created row', async () => {
      const actor = await configManager()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/country-config/reporting-rules'),
        actor,
      ).send({
        authorityId,
        reportTypeId,
        seriousnessClass: 'serious',
        windowDays: 15,
        submissionDestination: 'ethics_committee_and_trial_portal',
        sourceReference: 'GUD/022 §6.1',
        effectiveFrom: '2026-01-01',
      })

      expect(res.status).toBe(201)
      expect(res.body.data.submissionDestination).toBe('ethics_committee_and_trial_portal')
      expect(res.body.data.sourceReference).toBe('GUD/022 §6.1')
    })

    it('a rule created with unverified:true still cannot be activated — the existing guard is unaffected by the new fields', async () => {
      const actor = await configManager()

      const created = await authedWrite(
        request(httpServer(app)).post('/api/v1/country-config/reporting-rules'),
        actor,
      ).send({
        authorityId,
        reportTypeId,
        seriousnessClass: 'non_serious',
        windowDays: 30,
        unverified: true,
        sourceReference: 'Placeholder — needs field-expert confirmation',
        effectiveFrom: '2026-01-01',
      })
      expect(created.status).toBe(201)

      const activateRes = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/country-config/reporting-rules/${created.body.data.id}/activate`,
        ),
        actor,
      )

      expect(activateRes.status).toBe(400)
      expect(activateRes.body.error.code).toBe('RULE_UNVERIFIED')
    })

    it('the "duplicate as verified" flow (create a new version with unverified:false from an unverified draft own values) works end-to-end', async () => {
      const actor = await configManager()

      const draft = await authedWrite(
        request(httpServer(app)).post('/api/v1/country-config/reporting-rules'),
        actor,
      ).send({
        authorityId,
        reportTypeId,
        seriousnessClass: 'serious',
        windowDays: 3,
        unverified: true,
        effectiveFrom: '2026-01-01',
      })
      expect(draft.body.data.version).toBe(1)

      const verified = await authedWrite(
        request(httpServer(app)).post('/api/v1/country-config/reporting-rules'),
        actor,
      ).send({
        authorityId,
        reportTypeId,
        seriousnessClass: 'serious',
        windowDays: 3,
        unverified: false,
        sourceReference: 'Confirmed by field expert 2026-08-11',
        effectiveFrom: '2026-01-01',
      })
      expect(verified.body.data.version).toBe(2)

      const activated = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/country-config/reporting-rules/${verified.body.data.id}/activate`,
        ),
        actor,
      )
      expect(activated.status).toBe(201)
      expect(activated.body.data.status).toBe('active')
    })
  })

  // ── Gap 2 — RegulatoryAuthority CRUD ────────────────────────────────────

  describe('RegulatoryAuthority CRUD', () => {
    it('GET /regulatory-authorities is open to any authenticated user', async () => {
      const actor = await noPermsActor()

      const res = await authed(
        request(httpServer(app)).get('/api/v1/regulatory-authorities'),
        actor,
      )

      expect(res.status).toBe(200)
      const authorities = res.body.data as { id: string }[]
      expect(authorities.some((a) => a.id === authorityId)).toBe(true)
    })

    it('GET /regulatory-authorities/emblem-assets lists the real bundled Kenya emblem', async () => {
      const actor = await noPermsActor()

      const res = await authed(
        request(httpServer(app)).get('/api/v1/regulatory-authorities/emblem-assets'),
        actor,
      )

      expect(res.status).toBe(200)
      expect(res.body.data).toContain('kenya-coat-of-arms')
    })

    it('a non-platform-config-manage actor is forbidden from creating an authority', async () => {
      const actor = await noPermsActor()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/regulatory-authorities'),
        actor,
      ).send({
        countryId,
        code: 'NEW',
        name: 'Should Not Work',
      })

      expect(res.status).toBe(403)
    })

    it('creating an authority for a brand-new country is the entire mechanism for bringing that country online — the real, concrete example this gap closes', async () => {
      const actor = await configManager()
      const newCountryId = randomUUID()
      await testPrisma.country.create({ data: { id: newCountryId, isoCode: 'RW', name: 'Rwanda' } })

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/regulatory-authorities'),
        actor,
      ).send({
        countryId: newCountryId,
        code: 'RFDA',
        name: 'Rwanda FDA',
        formCode: 'RFDA/PV/001',
        ministryName: 'MINISTRY OF HEALTH',
        contactEmail: 'pv@rfda.gov.rw',
      })

      expect(res.status).toBe(201)
      expect(res.body.data.countryId).toBe(newCountryId)

      const listRes = await authed(
        request(httpServer(app)).get(`/api/v1/regulatory-authorities?countryId=${newCountryId}`),
        actor,
      )
      expect(listRes.body.data).toHaveLength(1)
    })

    it('rejects an emblemAssetKey that has no real bundled asset file', async () => {
      const actor = await configManager()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/regulatory-authorities'),
        actor,
      ).send({
        countryId,
        code: 'FAKE',
        name: 'Fake Authority',
        emblemAssetKey: 'totally-made-up',
      })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('EMBLEM_ASSET_NOT_FOUND')
    })

    it('updates letterhead fields and clears emblemAssetKey via an empty string', async () => {
      const actor = await configManager()

      const res = await authedWrite(
        request(httpServer(app)).patch(`/api/v1/regulatory-authorities/${authorityId}`),
        actor,
      ).send({
        ministryName: 'MINISTRY OF HEALTH, UGANDA',
        emblemAssetKey: '',
      })

      expect(res.status).toBe(200)
      expect(res.body.data.ministryName).toBe('MINISTRY OF HEALTH, UGANDA')
      expect(res.body.data.emblemAssetKey).toBeNull()
    })

    it('rejects a duplicate (countryId, code) pair with a real conflict', async () => {
      const actor = await configManager()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/regulatory-authorities'),
        actor,
      ).send({
        countryId,
        code: 'NDA',
        name: 'Duplicate',
      })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('AUTHORITY_ALREADY_EXISTS')
    })

    // testing-todo — real-usage feedback, 19 Aug 2026: "by configuration I
    // mean that for any country that image should be uploadable so that
    // even the field expert can handle it." The per-authority admin
    // upload path, replacing "bundled assets only."
    it('uploads a real emblem image, forbids a non-image content type, and a non-platform-config-manage actor is forbidden', async () => {
      const manager = await configManager()
      const noPerms = await noPermsActor()

      const forbidden = await authedWrite(
        request(httpServer(app)).post(`/api/v1/regulatory-authorities/${authorityId}/emblem`),
        noPerms,
      ).attach('file', Buffer.from('fake-png-bytes'), {
        filename: 'emblem.png',
        contentType: 'image/png',
      })
      expect(forbidden.status).toBe(403)

      const badType = await authedWrite(
        request(httpServer(app)).post(`/api/v1/regulatory-authorities/${authorityId}/emblem`),
        manager,
      ).attach('file', Buffer.from('not-an-image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      expect(badType.status).toBe(400)
      expect(badType.body.error.code).toBe('INVALID_EMBLEM_TYPE')

      const uploaded = await authedWrite(
        request(httpServer(app)).post(`/api/v1/regulatory-authorities/${authorityId}/emblem`),
        manager,
      ).attach('file', Buffer.from('fake-png-bytes'), {
        filename: 'emblem.png',
        contentType: 'image/png',
      })
      expect(uploaded.status).toBe(201)
      expect(uploaded.body.data.emblemObjectKey).toEqual(
        expect.stringContaining(`regulatory-authorities/${authorityId}/emblem-`),
      )

      const removed = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/regulatory-authorities/${authorityId}/emblem/remove`,
        ),
        manager,
      )
      expect(removed.status).toBe(201)
      expect(removed.body.data.emblemObjectKey).toBeNull()
    })
  })

  // ── Gap 3 — AuditRequirementDefinition admin editing ────────────────────

  describe('AuditRequirementDefinition admin editing', () => {
    it('adds a genuinely new person_uploads requirement without touching any resolver', async () => {
      const actor = await configManager()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/governance/requirement-definitions'),
        actor,
      ).send({
        authorityId,
        requirementKey: 'field_expert_new_row',
        sortOrder: 16,
        title: 'A field-expert-identified requirement',
        description: 'Not in the original 15 — added directly from real guidance.',
        guidelineReference: 'GUD/099 §2',
        source: 'person_uploads',
        evidenceArtifactType: 'Document',
      })

      expect(res.status).toBe(201)
      expect(res.body.data.source).toBe('person_uploads')
      expect(res.body.data.guidelineReference).toBe('GUD/099 §2')
    })

    it('patches only the guideline reference on an existing definition, never touching source', async () => {
      const actor = await configManager()
      const definitionId = randomUUID()
      await testPrisma.auditRequirementDefinition.create({
        data: {
          id: definitionId,
          authorityId,
          requirementKey: 'psmf_in_place',
          sortOrder: 4,
          title: 'PSMF in place and in use',
          description: 'Pulled live from Stage 16.1.',
          source: 'system_generated',
          evidenceArtifactType: 'Psmf',
        },
      })

      const res = await authedWrite(
        request(httpServer(app)).patch(
          `/api/v1/governance/requirement-definitions/${definitionId}`,
        ),
        actor,
      ).send({
        guidelineReference: 'GUD/006 §2.1',
      })

      expect(res.status).toBe(200)
      expect(res.body.data.guidelineReference).toBe('GUD/006 §2.1')
      expect(res.body.data.source).toBe('system_generated')
    })

    it('rejects a request body that includes "source" outright — the global ValidationPipe (forbidNonWhitelisted) refuses it since the update DTO has no such field, never silently changing which resolver a row is bound to', async () => {
      const actor = await configManager()
      const definitionId = randomUUID()
      await testPrisma.auditRequirementDefinition.create({
        data: {
          id: definitionId,
          authorityId,
          requirementKey: 'psmf_in_place_2',
          sortOrder: 4,
          title: 'PSMF in place and in use',
          description: 'Pulled live from Stage 16.1.',
          source: 'system_generated',
          evidenceArtifactType: 'Psmf',
        },
      })

      const res = await authedWrite(
        request(httpServer(app)).patch(
          `/api/v1/governance/requirement-definitions/${definitionId}`,
        ),
        actor,
      ).send({
        source: 'person_uploads',
        title: 'Still editable',
      })

      expect(res.status).toBe(400)
    })
  })

  // ── Gap 4 — RBAC admin ───────────────────────────────────────────────────

  describe('RBAC admin', () => {
    it('a non-platform.rbac.manage actor is forbidden from creating a permission', async () => {
      const actor = await noPermsActor()

      const res = await authedWrite(
        request(httpServer(app)).post('/api/v1/rbac-admin/permissions'),
        actor,
      ).send({
        key: 'pv.new_thing',
        description: 'Should not work',
      })

      expect(res.status).toBe(403)
    })

    it('creates a new permission and a new role wired to it — closing the real FPPV taxonomy gap this admin panel exists for', async () => {
      const actor = await rbacManager()

      const permRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/rbac-admin/permissions'),
        actor,
      ).send({
        key: 'pv.fppv_forward_case',
        description: 'Forward an intake to the external MAH (FPPV remit)',
      })
      expect(permRes.status).toBe(201)

      const roleRes = await authedWrite(
        request(httpServer(app)).post('/api/v1/rbac-admin/roles'),
        actor,
      ).send({
        key: 'FPPV',
        name: 'Focal Person for PV',
        description: 'Distributor-level PV contact, per GUD/006 §5.',
        permissions: ['pv.fppv_forward_case'],
      })

      expect(roleRes.status).toBe(201)
      expect(roleRes.body.data.key).toBe('FPPV')

      const catalog = await authed(request(httpServer(app)).get('/api/v1/roles'), actor)
      const roles = catalog.body.data as { key: string; permissions: { key: string }[] }[]
      const fppv = roles.find((r) => r.key === 'FPPV')
      expect(fppv?.permissions.map((p) => p.key)).toContain('pv.fppv_forward_case')
    })

    it('updateRolePermissions fully replaces the set and bumps tokenVersion so the change takes effect on the very next request', async () => {
      const actor = await rbacManager()
      await seedRole('QPPV', ['pv.capture_case'], false)
      await seedPermission('pv.medical_review')
      const qppvUser = await createAuthenticatedActor(app, testPrisma, { roleKeys: ['QPPV'] })

      // Before the change: the QPPV actor's already-minted token still carries the old permission set.
      const beforeMe = await authed(request(httpServer(app)).get('/api/v1/roles'), qppvUser)
      expect(beforeMe.status).toBe(200)

      const patchRes = await authedWrite(
        request(httpServer(app)).patch('/api/v1/rbac-admin/roles/QPPV/permissions'),
        actor,
      ).send({
        permissions: ['pv.medical_review'],
      })
      expect(patchRes.status).toBe(200)
      expect(patchRes.body.data.userCount).toBe(1)

      const catalog = await authed(request(httpServer(app)).get('/api/v1/roles'), actor)
      const roles = catalog.body.data as { key: string; permissions: { key: string }[] }[]
      const qppv = roles.find((r) => r.key === 'QPPV')
      expect(qppv?.permissions.map((p) => p.key)).toEqual(['pv.medical_review'])

      // The QPPV user's own pre-existing token is now stale — the next request 401s, matching the
      // existing `UsersService.updateRoles()` tokenVersion-bump precedent this reuses at role scale.
      const afterMe = await authed(request(httpServer(app)).get('/api/v1/roles'), qppvUser)
      expect(afterMe.status).toBe(401)
    })

    it('getRoleImpact reports zero for a role nobody currently holds', async () => {
      const actor = await rbacManager()
      await seedRole('EXECUTIVE_READONLY', ['records.view_all'], false)

      const res = await authed(
        request(httpServer(app)).get('/api/v1/rbac-admin/roles/EXECUTIVE_READONLY/impact'),
        actor,
      )

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({
        roleKey: 'EXECUTIVE_READONLY',
        userCount: 0,
        companyCount: 0,
      })
    })
  })
})
