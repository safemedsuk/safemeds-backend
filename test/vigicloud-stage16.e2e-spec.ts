import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { AUDIT_REQUIREMENTS } from '../prisma/audit-requirements.seed-data'
import { newId } from '../src/common/id'
import {
  PutObjectResult,
  StorageService,
  VerifiedObject,
} from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

interface AuditRequirementRowFixture {
  definitionId: string
  requirementKey: string
  source: string
  status: string
  evidenceDocumentId: string | null
}

function findRow(rows: unknown, requirementKey: string): AuditRequirementRowFixture {
  const row = (rows as AuditRequirementRowFixture[]).find(
    (r) => r.requirementKey === requirementKey,
  )
  if (!row) throw new Error(`Row ${requirementKey} not found in dashboard response`)
  return row
}

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<string> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: {
      id: randomUUID(),
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
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    })
  }
  return role.id
}

/** Same fake used by `test/documents-upload.e2e-spec.ts` — see that file's own doc comment for why a real R2 call can't run inside Jest e2e. */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>()

  putObject(key: string, body: Buffer, _contentType: string): Promise<PutObjectResult> {
    this.objects.set(key, body)
    return Promise.resolve({
      key,
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: body.byteLength,
    })
  }

  verifyObject(key: string): Promise<VerifiedObject> {
    const body = this.objects.get(key)
    if (!body) return Promise.reject(new Error('NoSuchKey'))
    return Promise.resolve({
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: body.byteLength,
    })
  }

  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_DOWNLOAD:${key}`)
  }

  presignUpload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_UPLOAD:${key}`)
  }
}

/**
 * VigiCloud Stage 16 — Governance & Audit Module (16.1 PSMF through 16.6
 * Training Records). Real HTTP coverage against a real seeded company,
 * matching every prior stage's own e2e conventions, with `StorageService`
 * faked exactly like `documents-upload.e2e-spec.ts` since several flows
 * here (PSMF activation, SDEA activation, QPPV nomination letters,
 * training certificates) go through the real Documents/R2 pipeline.
 */
async function seedCapaEvidence(companyId: string, capaId: string): Promise<void> {
  await testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    await tx.document.create({
      data: {
        id: randomUUID(),
        companyId,
        recordType: 'capa',
        recordId: capaId,
        title: 'e2e evidence',
      },
    })
  })
}

describe('VigiCloud Stage 16 (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string

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
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'Stage16 Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    // Stage 16.2's `AuditReadinessService.getDashboard()` scopes
    // `AuditRequirementDefinition` rows by the company's own home
    // country's authority — this file creates its own fresh, isolated
    // country per test (this repo's own e2e convention, never depending
    // on `pnpm prisma:seed` having been run against `safemeds_test`), so
    // it needs its own authority + the same 15-row catalog seeded
    // against it, not the real seed script's Kenya/PPB rows.
    const authorityId = randomUUID()
    await testPrisma.regulatoryAuthority.create({
      data: { id: authorityId, countryId, code: 'PPB', name: 'Pharmacy and Poisons Board' },
    })
    for (const req of AUDIT_REQUIREMENTS) {
      await testPrisma.auditRequirementDefinition.create({
        data: {
          id: newId(),
          authorityId,
          requirementKey: req.requirementKey,
          sortOrder: req.sortOrder,
          title: req.title,
          description: req.description,
          source: req.source,
          evidenceArtifactType: req.evidenceArtifactType,
          isMandatory: req.isMandatory,
        },
      })
    }
  })

  async function actorWith(roleKey: string, permissions: string[]): Promise<TestActor> {
    await seedRoleWithPermissions(roleKey, permissions)
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [roleKey] })
  }

  async function uploadDocumentFor(
    recordType: string,
    recordId: string,
    actor: TestActor,
    title: string,
  ): Promise<string> {
    const res = await authedWrite(
      request(httpServer(app)).post(`/api/v1/records/${recordType}/${recordId}/documents/upload`),
      actor,
    )
      .field('title', title)
      .attach('file', Buffer.from(`%PDF-1.4\n${title}\n`), {
        filename: 'evidence.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)
    return res.body.data.document.id as string
  }

  describe('Stage 16.1 — PSMF and the entitlement gate', () => {
    it('blocks switching VigiCloud on with no active PSMF, then allows it once one is created and activated', async () => {
      const superAdmin = await createAuthenticatedActor(app, testPrisma, {
        platformRole: 'super_admin',
      })
      const admin = await actorWith('SYSTEM_ADMINISTRATOR_16A', ['psmf.manage', 'documents.manage'])

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`),
        superAdmin,
      )
        .send({ moduleKey: 'vigicloud', enabled: true })
        .expect(409)

      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/psmf'), admin)
        .send({ title: 'SafeMeds PSMF v1' })
        .expect(201)
      expect(draft.body.data.status).toBe('draft')
      const draftId = draft.body.data.id as string

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/activate`),
        admin,
      ).expect(409)

      const documentId = await uploadDocumentFor('psmf', draftId, admin, 'PSMF document')
      await authedWrite(request(httpServer(app)).post(`/api/v1/psmf/${draftId}/document`), admin)
        .send({ documentId })
        .expect(201)

      const activated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/activate`),
        admin,
      ).expect(201)
      expect(activated.body.data.status).toBe('active')

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/platform/companies/${companyId}/entitlements`),
        superAdmin,
      )
        .send({ moduleKey: 'vigicloud', enabled: true })
        .expect(201)
    })

    it('real-usage content, 11 Sep 2026 — "create from scratch" generates a real PDF from structured content and activates with zero manual upload', async () => {
      const admin = await actorWith('SYSTEM_ADMINISTRATOR_16D', ['psmf.manage', 'documents.manage'])

      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/psmf'), admin)
        .send({ title: 'Created From Scratch' })
        .expect(201)
      const draftId = draft.body.data.id as string

      const content = {
        reference: {
          psmfReferenceNumber: 'MAH/KE/PSMF/002',
          mainLocationOfPvActivities: 'Nairobi, Kenya',
        },
        qppv: { primary: { fullName: 'Amara Wanjiru', professionalQualification: 'B.Pharm' } },
      }
      const saved = await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/content`),
        admin,
      )
        .send({ content })
        .expect(201)
      expect(saved.body.data.content).toEqual(content)
      expect(saved.body.data.documentId).toBeNull()

      const generated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/generate-document`),
        admin,
      ).expect(201)
      expect(generated.body.data.documentId).toBeTruthy()

      const activated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/activate`),
        admin,
      ).expect(201)
      expect(activated.body.data.status).toBe('active')
      expect(activated.body.data.documentId).toBe(generated.body.data.documentId)
    })

    it('a second PSMF version retires the first once activated', async () => {
      const admin = await actorWith('SYSTEM_ADMINISTRATOR_16B', [
        'psmf.manage',
        'psmf.view',
        'documents.manage',
      ])

      const v1 = await authedWrite(request(httpServer(app)).post('/api/v1/psmf'), admin)
        .send({ title: 'v1' })
        .expect(201)
      const v1Id = v1.body.data.id as string
      const doc1 = await uploadDocumentFor('psmf', v1Id, admin, 'v1 doc')
      await authedWrite(request(httpServer(app)).post(`/api/v1/psmf/${v1Id}/document`), admin)
        .send({ documentId: doc1 })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${v1Id}/activate`),
        admin,
      ).expect(201)

      const v2 = await authedWrite(request(httpServer(app)).post('/api/v1/psmf'), admin)
        .send({ title: 'v2' })
        .expect(201)
      const v2Id = v2.body.data.id as string
      const doc2 = await uploadDocumentFor('psmf', v2Id, admin, 'v2 doc')
      await authedWrite(request(httpServer(app)).post(`/api/v1/psmf/${v2Id}/document`), admin)
        .send({ documentId: doc2 })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${v2Id}/activate`),
        admin,
      ).expect(201)

      const list = await authed(request(httpServer(app)).get('/api/v1/psmf'), admin).expect(200)
      const psmfRows = list.body.data as { version: number; status: string }[]
      const byVersion = new Map<number, string>(psmfRows.map((p) => [p.version, p.status]))
      expect(byVersion.get(1)).toBe('retired')
      expect(byVersion.get(2)).toBe('active')
    })
  })

  describe('Stage 16.2 — Audit-readiness dashboard and audit pack', () => {
    it('resolves the dashboard live and flips to green once the PSMF requirement is met', async () => {
      const qppv = await actorWith('QPPV_16C', [
        'governance.view',
        'governance.manage',
        'psmf.manage',
        'documents.manage',
      ])

      const before = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        qppv,
      ).expect(200)
      expect(before.body.data.overall).toBe('red')
      const psmfRow = findRow(before.body.data.rows, 'psmf_in_place')
      expect(psmfRow.status).toBe('missing')

      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/psmf'), qppv)
        .send({ title: 'PSMF' })
        .expect(201)
      const draftId = draft.body.data.id as string
      const documentId = await uploadDocumentFor('psmf', draftId, qppv, 'PSMF doc')
      await authedWrite(request(httpServer(app)).post(`/api/v1/psmf/${draftId}/document`), qppv)
        .send({ documentId })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/psmf/${draftId}/activate`),
        qppv,
      ).expect(201)

      const after = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        qppv,
      ).expect(200)
      const psmfRowAfter = findRow(after.body.data.rows, 'psmf_in_place')
      expect(psmfRowAfter.status).toBe('ready')

      // testing-todo Stage 16.2-A — re-verifying against a real,
      // properly configured (Kenya-style) home country: the dashboard
      // reports the real country name and confirms an authority exists.
      expect(before.body.data.homeCountryName).toBe('Kenya')
      expect(before.body.data.authorityConfigured).toBe(true)
    })

    it('testing-todo 16.2-A — a company whose home country has zero configured content gets an honest empty response, not a silent blank table', async () => {
      const unconfiguredCountryId = randomUUID()
      await testPrisma.country.create({
        data: { id: unconfiguredCountryId, isoCode: 'CM', name: 'Cameroon' },
      })
      const unconfiguredCompanyId = randomUUID()
      await testPrisma.company.create({
        data: {
          id: unconfiguredCompanyId,
          name: 'Unconfigured Country Co',
          companyType: 'manufacturer',
          homeCountryId: unconfiguredCountryId,
          status: 'active',
        },
      })
      await seedRoleWithPermissions('QPPV_16C2', ['governance.view'])
      const actor = await createAuthenticatedActor(app, testPrisma, {
        companyId: unconfiguredCompanyId,
        roleKeys: ['QPPV_16C2'],
      })

      const dashboard = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        actor,
      ).expect(200)

      expect(dashboard.body.data.rows).toEqual([])
      expect(dashboard.body.data.homeCountryName).toBe('Cameroon')
      expect(dashboard.body.data.authorityConfigured).toBe(false)
      // The real bug this guards: 0 ready === 0 mandatory used to be
      // vacuously "green" (fully ready) for a company with nothing
      // configured at all.
      expect(dashboard.body.data.overall).toBe('red')
    })

    it('updates a person_uploads row and generates a real archived audit pack PDF', async () => {
      const qppv = await actorWith('QPPV_16D', [
        'governance.view',
        'governance.manage',
        'documents.manage',
      ])

      const dashboard = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        qppv,
      ).expect(200)
      const cvRow = findRow(dashboard.body.data.rows, 'qppv_cv_qualifications')
      expect(cvRow.source).toBe('person_uploads')

      const documentId = await uploadDocumentFor(
        'audit_requirement_record',
        cvRow.definitionId,
        qppv,
        'QPPV CV',
      )
      await authedWrite(
        request(httpServer(app)).patch(`/api/v1/governance/audit-readiness/${cvRow.definitionId}`),
        qppv,
      )
        .send({ status: 'ready', documentId })
        .expect(200)

      const afterUpdate = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        qppv,
      ).expect(200)
      const cvRowAfter = findRow(afterUpdate.body.data.rows, 'qppv_cv_qualifications')
      expect(cvRowAfter.status).toBe('ready')
      expect(cvRowAfter.evidenceDocumentId).toBe(documentId)

      const pack = await authedWrite(
        request(httpServer(app)).post('/api/v1/governance/audit-packs'),
        qppv,
      ).expect(201)
      expect(pack.body.data.pdfDocumentId).toBeTruthy()

      const list = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-packs'),
        qppv,
      ).expect(200)
      expect(list.body.data).toHaveLength(1)
    })

    it('exports the AE log as CSV', async () => {
      const qppv = await actorWith('QPPV_16E', ['governance.view'])
      const res = await authed(
        request(httpServer(app)).get('/api/v1/governance/ae-log/export'),
        qppv,
      ).expect(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.text.split('\n')[0]).toBe('Reference,Received Date,Status,Seriousness')
    })
  })

  describe('Stage 16.3 — Internal audits, findings, and the CAPA effectiveness gate', () => {
    it('schedules an audit, logs a finding, opens a linked CAPA, and blocks closing it without an effectiveness check', async () => {
      const qa = await actorWith('QUALITY_ASSOCIATE_16F', [
        'quality.manage_capa',
        'quality.view_all',
      ])
      const qm = await actorWith('QUALITY_MANAGER_16F', ['quality.close_capa', 'quality.view_all'])

      const audit = await authedWrite(request(httpServer(app)).post('/api/v1/internal-audits'), qa)
        .send({ title: 'Q3 GVP Audit', scheduledDate: '2026-09-01' })
        .expect(201)
      const auditId = audit.body.data.id as string

      const finding = await authedWrite(
        request(httpServer(app)).post(`/api/v1/internal-audits/${auditId}/findings`),
        qa,
      )
        .send({ description: 'No signed SDEA on file for Meridian Pharma', severity: 'major' })
        .expect(201)
      const findingId = finding.body.data.id as string

      const capa = await authedWrite(request(httpServer(app)).post('/api/v1/capas'), qa)
        .send({
          findingId,
          rootCause: 'No countersigned SDEA on file for the distributor',
          rootCauseCategory: 'management_oversight',
          correctiveAction: 'Send template SDEA for countersignature',
          ownerUserId: qa.userId,
          correctiveActionDueDate: '2026-12-01',
        })
        .expect(201)
      const capaId = capa.body.data.id as string

      // The QA role opened it; only quality.close_capa (Quality Manager) can close it, and only after an effectiveness check.
      await authedWrite(request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`), qm).expect(
        409,
      )

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/effectiveness-check`),
        qm,
      )
        .send({ result: 'effective' })
        .expect(201)
      await seedCapaEvidence(companyId, capaId)
      const closed = await authedWrite(
        request(httpServer(app)).post(`/api/v1/capas/${capaId}/close`),
        qm,
      ).expect(201)
      expect(closed.body.data.status).toBe('closed')

      const auditDetail = await authed(
        request(httpServer(app)).get(`/api/v1/internal-audits/${auditId}`),
        qa,
      ).expect(200)
      expect(auditDetail.body.data.findings).toHaveLength(1)

      const findingDetail = await withBypass((tx) =>
        tx.auditFinding.findUniqueOrThrow({ where: { id: findingId } }),
      )
      expect(findingDetail.status).toBe('closed')
    })
  })

  describe('Stage 16.4 — QPPV nomination', () => {
    it('nominates a primary and backup QPPV, generates a real letter PDF, and accepts a regulator-confirmation upload', async () => {
      await seedRoleWithPermissions('QPPV', ['pv.capture_case'])
      const primaryQppv = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['QPPV'],
      })
      const backupQppv = await createAuthenticatedActor(app, testPrisma, {
        companyId,
        roleKeys: ['QPPV'],
      })
      const admin = await actorWith('SYSTEM_ADMINISTRATOR_16G', [
        'qppv.manage_nomination',
        'governance.view',
        'documents.manage',
      ])

      const primaryNomination = await authedWrite(
        request(httpServer(app)).post('/api/v1/qppv/nominations'),
        admin,
      )
        .send({ role: 'primary', qppvUserId: primaryQppv.userId })
        .expect(201)
      expect(primaryNomination.body.data.nominationLetterDocumentId).toBeTruthy()
      const primaryNominationId = primaryNomination.body.data.id as string

      await authedWrite(request(httpServer(app)).post('/api/v1/qppv/nominations'), admin)
        .send({ role: 'backup', qppvUserId: backupQppv.userId })
        .expect(201)

      const status = await authed(
        request(httpServer(app)).get('/api/v1/qppv/status'),
        admin,
      ).expect(200)
      expect(status.body.data.primaryQppvUserId).toBe(primaryQppv.userId)
      expect(status.body.data.backupQppvUserId).toBe(backupQppv.userId)

      const confirmationDocId = await uploadDocumentFor(
        'qppv_nomination',
        primaryNominationId,
        admin,
        'PPB confirmation letter',
      )
      const confirmed = await authedWrite(
        request(httpServer(app)).post(
          `/api/v1/qppv/nominations/${primaryNominationId}/regulator-confirmation`,
        ),
        admin,
      )
        .send({ documentId: confirmationDocId })
        .expect(201)
      expect(confirmed.body.data.regulatorConfirmationDocumentId).toBe(confirmationDocId)

      // Closes the loop with Stage 16.2's own qppv_nomination resolver.
      const dashboard = await authed(
        request(httpServer(app)).get('/api/v1/governance/audit-readiness'),
        admin,
      ).expect(200)
      const nominationRow = findRow(dashboard.body.data.rows, 'qppv_nomination')
      expect(nominationRow.status).toBe('ready')
    })

    it('rejects nominating a user without the QPPV role', async () => {
      const admin = await actorWith('SYSTEM_ADMINISTRATOR_16H', ['qppv.manage_nomination'])
      const nonQppv = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [] })
      await authedWrite(request(httpServer(app)).post('/api/v1/qppv/nominations'), admin)
        .send({ role: 'primary', qppvUserId: nonQppv.userId })
        .expect(400)
    })
  })

  describe('Stage 16.5 — SDEA repository and the reconciliation-at-risk flag', () => {
    it('creates, attaches a document, and activates an SDEA — surfacing the real distributor status at every stage', async () => {
      const manager = await actorWith('QUALITY_MANAGER_16I', [
        'sdea.manage',
        'sdea.view',
        'reconciliation.manage',
        'documents.manage',
      ])

      const distributor = await authedWrite(
        request(httpServer(app)).post('/api/v1/distributors'),
        manager,
      )
        .send({ name: 'Meridian Pharma Distributors' })
        .expect(201)
      const distributorId = distributor.body.data.id as string

      const missing = await authed(
        request(httpServer(app)).get(`/api/v1/sdea/distributor/${distributorId}/status`),
        manager,
      ).expect(200)
      expect(missing.body.data.status).toBe('missing')

      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/sdea'), manager)
        .send({ distributorId, title: 'Meridian SDEA', counterpartyName: 'Meridian Pharma' })
        .expect(201)
      const draftId = draft.body.data.id as string

      await authedWrite(
        request(httpServer(app)).post(`/api/v1/sdea/${draftId}/activate`),
        manager,
      ).expect(409)

      const documentId = await uploadDocumentFor('sdea', draftId, manager, 'Signed SDEA')
      await authedWrite(request(httpServer(app)).post(`/api/v1/sdea/${draftId}/document`), manager)
        .send({ documentId })
        .expect(201)
      const activated = await authedWrite(
        request(httpServer(app)).post(`/api/v1/sdea/${draftId}/activate`),
        manager,
      ).expect(201)
      expect(activated.body.data.status).toBe('active')

      const active = await authed(
        request(httpServer(app)).get(`/api/v1/sdea/distributor/${distributorId}/status`),
        manager,
      ).expect(200)
      expect(active.body.data.status).toBe('active')
    })

    it('surfaces expiring/expired status from a real expiry date', async () => {
      const manager = await actorWith('QUALITY_MANAGER_16J', [
        'sdea.manage',
        'sdea.view',
        'reconciliation.manage',
        'documents.manage',
      ])
      const distributor = await authedWrite(
        request(httpServer(app)).post('/api/v1/distributors'),
        manager,
      )
        .send({ name: 'Zenith Distributors' })
        .expect(201)
      const distributorId = distributor.body.data.id as string

      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const draft = await authedWrite(request(httpServer(app)).post('/api/v1/sdea'), manager)
        .send({ distributorId, title: 'Zenith SDEA', counterpartyName: 'Zenith', expiryDate: past })
        .expect(201)
      const draftId = draft.body.data.id as string
      const documentId = await uploadDocumentFor('sdea', draftId, manager, 'Signed SDEA')
      await authedWrite(request(httpServer(app)).post(`/api/v1/sdea/${draftId}/document`), manager)
        .send({ documentId })
        .expect(201)
      await authedWrite(
        request(httpServer(app)).post(`/api/v1/sdea/${draftId}/activate`),
        manager,
      ).expect(201)

      const status = await authed(
        request(httpServer(app)).get(`/api/v1/sdea/distributor/${distributorId}/status`),
        manager,
      ).expect(200)
      expect(status.body.data.status).toBe('expired')
    })
  })

  describe('Stage 16.6 — Training records', () => {
    it('logs a training record, attaches a certificate, and reports a live computed status', async () => {
      const manager = await actorWith('QUALITY_MANAGER_16K', [
        'training.manage',
        'training.view',
        'documents.manage',
      ])
      const staff = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: [] })

      const record = await authedWrite(
        request(httpServer(app)).post('/api/v1/training-records'),
        manager,
      )
        .send({
          userId: staff.userId,
          trainingType: 'gvp_certificate',
          title: 'GVP Refresher 2026',
          completionDate: '2026-01-01',
          expiryDate: '2027-01-01',
        })
        .expect(201)
      expect(record.body.data.trainingType).toBe('gvp_certificate')
      const recordId = record.body.data.id as string

      const documentId = await uploadDocumentFor(
        'training_record',
        recordId,
        manager,
        'GVP certificate',
      )
      const withCert = await authedWrite(
        request(httpServer(app)).post(`/api/v1/training-records/${recordId}/certificate`),
        manager,
      )
        .send({ documentId })
        .expect(201)
      expect(withCert.body.data.certificateDocumentId).toBe(documentId)

      const list = await authed(
        request(httpServer(app)).get('/api/v1/training-records'),
        manager,
      ).expect(200)
      expect(list.body.data[0].computedStatus).toBe('valid')
    })

    it('is gated by training.manage/training.view', async () => {
      const noAccess = await actorWith('DISPENSING_PHARMACIST_16L', [])
      await authed(request(httpServer(app)).get('/api/v1/training-records'), noAccess).expect(403)
      await authedWrite(request(httpServer(app)).post('/api/v1/training-records'), noAccess)
        .send({
          userId: noAccess.userId,
          trainingType: 'x',
          title: 'y',
          completionDate: '2026-01-01',
        })
        .expect(403)
    })
  })
})
