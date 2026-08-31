import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

import { PutObjectResult, StorageService, VerifiedObject } from '../src/modules/documents/storage.service'
import { createAuthenticatedActor, TestActor } from './utils/auth-helper'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * Same in-memory `StorageService` stand-in `documents-upload.e2e-spec.ts`
 * uses, for the identical reason — `.env.test`'s `R2_ENDPOINT` is a
 * deliberate non-real placeholder, so a real `S3Client` call against it
 * fails at the TLS handshake, not at the application layer Stage 3.4's
 * test actually cares about.
 */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>()

  putObject(key: string, body: Buffer, _contentType: string): Promise<PutObjectResult> {
    this.objects.set(key, body)
    return Promise.resolve({ key, sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }

  verifyObject(key: string): Promise<VerifiedObject> {
    const body = this.objects.get(key)
    if (!body) return Promise.reject(new Error('NoSuchKey'))
    return Promise.resolve({ sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.byteLength })
  }

  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_DOWNLOAD:${key}`)
  }

  presignUpload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_UPLOAD:${key}`)
  }
}

function authed(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader)
}

function authedWrite(req: request.Test, actor: TestActor): request.Test {
  return req.set('Cookie', actor.cookieHeader).set('X-CSRF-Token', actor.csrfHeader)
}

function withBypass<T>(fn: (tx: typeof testPrisma) => Promise<T>): Promise<T> {
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return fn(tx as unknown as typeof testPrisma)
  })
}

/** The e2e test database gets no RBAC seed at all (only migrations, per `global-setup.ts`) — every spec seeds exactly the roles/permissions it needs, matching `pv-case.e2e-spec.ts`'s own pattern. */
async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
  const role = await testPrisma.role.upsert({
    where: { key: roleKey },
    update: {},
    create: { id: randomUUID(), key: roleKey, name: roleKey, description: 'e2e fixture', isPlatform: false },
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

const baseSubmission = {
  reporter: { reporterType: 'consumer', fullName: 'A Concerned Patient' },
  patient: { ageYears: 29, sex: 'male' },
  suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Amoxil 500mg' }],
  adverseEvents: [{ reportedTerm: 'Hives', narrative: 'Broke out in hives after the second dose' }],
  consent: { granted: true, method: 'written' },
}

/**
 * VigiCloud Stage 3.2 — real HTTP coverage for the public reporting URL/QR
 * flow: an admin generates a slug + intake email + sets the WhatsApp phone
 * number ID, downloads the QR PNG, then a fully anonymous, unauthenticated
 * caller resolves the company by slug and submits a case with no cookies at
 * all — mirroring exactly how a real member of the public would hit it.
 */
describe('VigiCloud Stage 3.2 — Public Reporting URL + QR (e2e)', () => {
  let app: INestApplication
  let companyId: string
  let countryId: string
  let definitionId: string

  beforeAll(async () => {
    app = await createTestApp((builder) => builder.overrideProvider(StorageService).useValue(new FakeStorageService()))
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    companyId = randomUUID()
    await testPrisma.company.create({ data: { id: companyId, name: 'Public Reporting Test Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'active' } })
    await testPrisma.reportType.create({ data: { id: randomUUID(), typeKey: 'adr', moduleKey: 'pv', name: 'Suspected ADR' } })

    // Same minimal `pv_case` workflow re-derivation `pv-case.e2e-spec.ts`
    // uses — required so `PvCaseService.createFromSystemChannel()`'s call
    // into `WorkflowService.instantiate()` finds an initial state.
    const superintendentRoleId = randomUUID()
    await testPrisma.role.create({ data: { id: superintendentRoleId, key: 'SUPERINTENDENT_PHARMACIST', name: 'Superintendent Pharmacist', description: 'e2e fixture', isPlatform: false } })
    definitionId = randomUUID()
    await testPrisma.workflowDefinition.create({ data: { id: definitionId, recordType: 'pv_case', reportTypeId: null, countryId: null, version: 1, status: 'active' } })
    const intakeId = randomUUID()
    const triageId = randomUUID()
    await testPrisma.workflowState.createMany({
      data: [
        { id: intakeId, definitionId, stateKey: 'intake', name: 'Intake', isInitial: true, isTerminal: false },
        { id: triageId, definitionId, stateKey: 'triage', name: 'Triage', isInitial: false, isTerminal: true },
      ],
    })
    await testPrisma.workflowTransition.create({
      data: { id: randomUUID(), definitionId, fromStateId: intakeId, toStateId: triageId, requiredRoleId: superintendentRoleId, requiresSignature: false },
    })
  })

  async function admin(): Promise<TestActor> {
    await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['company_profile.manage'])
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SYSTEM_ADMINISTRATOR'] })
  }

  async function triager(): Promise<TestActor> {
    await seedRoleWithPermissions('SUPERINTENDENT_PHARMACIST', ['pv.triage_case', 'pv.view_all'])
    return createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['SUPERINTENDENT_PHARMACIST'] })
  }

  it('generates a public reporting slug, downloads a real PNG QR code encoding it, and an anonymous caller resolves the company by slug', async () => {
    const actor = await admin()

    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string
    expect(slug).toMatch(/^[a-z0-9-]+$/)

    const qr = await authed(request(httpServer(app)).get('/api/v1/company/public-reporting/qr'), actor).expect(200)
    expect(qr.headers['content-type']).toBe('image/png')
    // PNG magic bytes.
    const qrBody = qr.body as Buffer
    expect(qrBody.slice(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    // No cookies at all — this is the actual anonymous public request.
    const resolved = await request(httpServer(app)).get(`/api/v1/report/${slug}`).expect(200)
    expect(resolved.body.data).toEqual({ companyName: 'Public Reporting Test Co', reportTypeName: 'Suspected ADR' })
  })

  it('404s resolving an unknown slug, and never leaks a suspended company', async () => {
    await request(httpServer(app)).get('/api/v1/report/not-a-real-slug').expect(404)

    const suspendedCompanyId = randomUUID()
    await testPrisma.company.create({
      data: { id: suspendedCompanyId, name: 'Suspended Reporter Co', companyType: 'manufacturer', homeCountryId: countryId, status: 'suspended', publicReportingSlug: 'suspended-reporter-co' },
    })
    await request(httpServer(app)).get('/api/v1/report/suspended-reporter-co').expect(404)
  })

  it('an anonymous submission creates a real, unconfirmed draft case (createdBy null, requiresDraftReview true) visible to a triage-permitted staff member', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string

    const submitted = await request(httpServer(app)).post(`/api/v1/report/${slug}`).send(baseSubmission).expect(201)
    expect(submitted.body.data.referenceNumber).toMatch(/^PV-\d{4}-\d{5}$/)

    const rawCase = await withBypass((tx) => tx.case.findFirstOrThrow({ where: { companyId, referenceNumber: submitted.body.data.referenceNumber } }))
    expect(rawCase.createdBy).toBeNull()
    expect(rawCase.requiresDraftReview).toBe(true)
    expect(rawCase.channel).toBe('public_url')

    // A triage-permitted staff member can see it in the draft-review queue
    // and confirm it.
    const triagerActor = await triager()
    const queue = await authed(request(httpServer(app)).get('/api/v1/pv/cases?requiresDraftReview=true'), triagerActor).expect(200)
    expect(queue.body.data).toHaveLength(1)
    expect(queue.body.data[0].id).toBe(rawCase.id)

    // Real-usage feedback, 19 Aug 2026 — confirming now requires claiming first.
    await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/claim-draft`), triagerActor).expect(201)
    const confirmed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/confirm-draft`), triagerActor).expect(201)
    expect(confirmed.body.data.requiresDraftReview).toBe(false)
  })

  it('confirming an unclaimed draft is rejected, and a second reviewer cannot claim what is already claimed — real-usage feedback, 19 Aug 2026', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string
    const submitted = await request(httpServer(app)).post(`/api/v1/report/${slug}`).send(baseSubmission).expect(201)
    const rawCase = await withBypass((tx) => tx.case.findFirstOrThrow({ where: { companyId, referenceNumber: submitted.body.data.referenceNumber } }))

    const triagerActor = await triager()
    const confirmRejected = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/confirm-draft`), triagerActor)
    expect(confirmRejected.status).toBe(409)
    expect(confirmRejected.body.error.code).toBe('MUST_CLAIM_FIRST')

    const claimed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/claim-draft`), triagerActor).expect(201)
    expect(claimed.body.data.draftClaimedBy).toBeTruthy()

    const secondTriager = await triager()
    const claimRejected = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/claim-draft`), secondTriager)
    expect(claimRejected.status).toBe(409)
    expect(claimRejected.body.error.code).toBe('ALREADY_CLAIMED')

    const released = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/release-draft`), triagerActor).expect(201)
    expect(released.body.data.draftClaimedBy).toBeNull()

    const nowClaimed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/claim-draft`), secondTriager).expect(201)
    expect(nowClaimed.body.data.draftClaimedBy).toBeTruthy()
    const confirmed = await authedWrite(request(httpServer(app)).post(`/api/v1/pv/cases/${rawCase.id}/confirm-draft`), secondTriager).expect(201)
    expect(confirmed.body.data.requiresDraftReview).toBe(false)
  })

  it('404s an anonymous submission against an unknown slug rather than creating a case for nobody', async () => {
    await request(httpServer(app)).post('/api/v1/report/not-a-real-slug').send(baseSubmission).expect(404)
  })

  it('400s an anonymous submission missing required fields (no reporter)', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string

    await request(httpServer(app))
      .post(`/api/v1/report/${slug}`)
      .send({ ...baseSubmission, reporter: undefined })
      .expect(400)
  })

  it('sets and reads back the intake email address and WhatsApp phone number ID', async () => {
    const actor = await admin()

    // EMAIL_INTAKE_DOMAIN is unset in .env.test — the admin gets a clear
    // 409 explaining inbound email intake isn't configured yet, not a 500.
    await authedWrite(request(httpServer(app)).post('/api/v1/company/intake-email'), actor).expect(409)

    const whatsapp = await authedWrite(request(httpServer(app)).patch('/api/v1/company/whatsapp-phone-number-id'), actor)
      .send({ whatsappBusinessPhoneNumberId: '1234567890' })
      .expect(200)
    expect(whatsapp.body.data.whatsappBusinessPhoneNumberId).toBe('1234567890')
  })

  it('403s slug generation for an actor without company_profile.manage', async () => {
    const noPermActor = await createAuthenticatedActor(app, testPrisma, { companyId, roleKeys: ['EXECUTIVE_READONLY'] })
    await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), noPermActor).expect(403)
  })

  it('an anonymous caller can search the company\'s own product catalog by slug, and only sees active products (Stage 3.2)', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string

    await withBypass((tx) =>
      tx.product.create({
        data: {
          id: randomUUID(),
          companyId,
          brandName: 'Amoxil',
          genericName: 'Amoxicillin',
          productCategory: 'medicinal',
          dosageForm: 'Tablet',
          strength: '500mg',
          innName: 'Amoxicillin',
          atcCode: 'J01CA04',
          isActive: true,
        },
      }),
    )
    await withBypass((tx) =>
      tx.product.create({
        data: {
          id: randomUUID(),
          companyId,
          brandName: 'Discontinued Drug',
          genericName: 'Old Compound',
          productCategory: 'medicinal',
          dosageForm: 'Tablet',
          strength: '10mg',
          isActive: false,
        },
      }),
    )

    const found = await request(httpServer(app)).get(`/api/v1/report/${slug}/products?q=amox`).expect(200)
    expect(found.body.data).toHaveLength(1)
    expect(found.body.data[0]).toEqual(expect.objectContaining({ brandName: 'Amoxil', atcCode: 'J01CA04' }))
    expect(found.body.data[0].companyId).toBeUndefined()

    const notFound = await request(httpServer(app)).get(`/api/v1/report/${slug}/products?q=discontinued`).expect(200)
    expect(notFound.body.data).toEqual([])
  })

  it('404s a product search against an unknown slug', async () => {
    await request(httpServer(app)).get('/api/v1/report/not-a-real-slug/products?q=amox').expect(404)
  })

  it('an anonymous reporter can attach a source document to their own report after submitting it (Stage 3.4)', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string

    const submitted = await request(httpServer(app)).post(`/api/v1/report/${slug}`).send(baseSubmission).expect(201)
    const referenceNumber = submitted.body.data.referenceNumber as string

    const fileContents = Buffer.from('%PDF-1.4\n%public-reporting-source-doc-test\n')
    const attached = await request(httpServer(app))
      .post(`/api/v1/report/${slug}/${referenceNumber}/document`)
      .attach('file', fileContents, { filename: 'packaging-photo.pdf', contentType: 'application/pdf' })
      .expect(201)
    expect(attached.body.data).toEqual({ attached: true })

    const rawCase = await withBypass((tx) => tx.case.findFirstOrThrow({ where: { companyId, referenceNumber } }))
    const sourceDocs = await withBypass((tx) => tx.sourceDocument.findMany({ where: { caseId: rawCase.id } }))
    expect(sourceDocs).toHaveLength(1)

    const document = await withBypass((tx) => tx.document.findFirstOrThrow({ where: { id: sourceDocs[0].documentId } }))
    expect(document.createdBy).toBeNull()
    expect(document.recordType).toBe('pv_case')
    expect(document.recordId).toBe(rawCase.id)
  })

  it('404s an attachment against an unknown reference number', async () => {
    const actor = await admin()
    const generated = await authedWrite(request(httpServer(app)).post('/api/v1/company/public-reporting/slug'), actor).expect(201)
    const slug = generated.body.data.publicReportingSlug as string

    await request(httpServer(app))
      .post(`/api/v1/report/${slug}/PV-2026-99999/document`)
      .attach('file', Buffer.from('bytes'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(404)
  })
})
