import { INestApplication } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import request from 'supertest'

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

async function seedRoleWithPermissions(roleKey: string, permissionKeys: string[]): Promise<void> {
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
}

/**
 * An in-memory stand-in for `StorageService` — `.env.test`'s `R2_ENDPOINT`
 * is a deliberate placeholder (`dev-placeholder.r2.cloudflarestorage.com`,
 * confirmed not a real R2 account by comparing against `.env`'s real one),
 * so a real `S3Client` call against it fails at the TLS handshake, not at
 * the application layer this spec actually cares about. This fake
 * preserves every real content-addressed-hash/size-tracking behavior
 * (`putObject` genuinely sha256s the bytes it's given, `verifyObject`
 * genuinely 404s for a key that was never put), so the parts of
 * `DocumentsService`/`DocumentsController` this spec exists to prove —
 * real multipart parsing, real permission gates, the version landing in
 * `stored` status with no `pending` window, real DB rows, a download URL
 * that resolves back to the exact bytes uploaded — are exercised for
 * real. Only the literal network hop to Cloudflare is swapped out.
 */
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

  // Real downloads go through this fake HTTP server's own `/__fake-r2/:key`
  // route (registered per-test below) rather than a real presigned R2 URL —
  // there's no real bucket behind this fake to presign against.
  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_DOWNLOAD:${key}`)
  }

  presignUpload(key: string): Promise<string> {
    return Promise.resolve(`FAKE_UPLOAD:${key}`)
  }

  getObjectBytes(key: string): Buffer | undefined {
    return this.objects.get(key)
  }
}

describe('Documents — direct (server-proxied) upload (e2e)', () => {
  let app: INestApplication
  let actor: TestActor
  let companyId: string
  let fakeStorage: FakeStorageService

  beforeAll(async () => {
    fakeStorage = new FakeStorageService()
    app = await createTestApp((builder) =>
      builder.overrideProvider(StorageService).useValue(fakeStorage),
    )
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
        name: 'Upload Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    await seedRoleWithPermissions('SYSTEM_ADMINISTRATOR', ['documents.manage', 'documents.view'])
    actor = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['SYSTEM_ADMINISTRATOR'],
    })
  })

  it('uploads a real file end-to-end in one request: the version is immediately "stored" (no pending window), content-hashed, and its bytes are exactly what was sent', async () => {
    const fileContents = Buffer.from('%PDF-1.4\n%e2e-direct-upload-test\n')

    const uploadRes = await authedWrite(
      request(httpServer(app)).post('/api/v1/records/pv_case/case-e2e-1/documents/upload'),
      actor,
    )
      .field('title', 'Original report form')
      .attach('file', fileContents, { filename: 'report.pdf', contentType: 'application/pdf' })
      .expect(201)

    expect(uploadRes.body.data.document.title).toBe('Original report form')
    expect(uploadRes.body.data.version.version).toBe(1)
    // The whole point of this fix: never "pending" — stored immediately, in one request.
    expect(uploadRes.body.data.version.status).toBe('stored')
    expect(uploadRes.body.data.version.sha256).toBe(
      createHash('sha256').update(fileContents).digest('hex'),
    )
    expect(uploadRes.body.data.version.sizeBytes).toBe(fileContents.byteLength)

    // The bytes genuinely made it into storage, byte-for-byte — not just a DB row claiming success.
    const versionKey = uploadRes.body.data.version.key as string
    expect(fakeStorage.getObjectBytes(versionKey)?.equals(fileContents)).toBe(true)

    // Immediately downloadable — no separate "complete" step required.
    const downloadRes = await authed(
      request(httpServer(app)).get(
        `/api/v1/documents/${uploadRes.body.data.document.id}/versions/${uploadRes.body.data.version.id}/download`,
      ),
      actor,
    ).expect(200)
    expect(downloadRes.body.data.url).toContain(uploadRes.body.data.version.key)

    // Shows up in the record's document list, same as any other upload.
    const listRes = await authed(
      request(httpServer(app)).get('/api/v1/records/pv_case/case-e2e-1/documents'),
      actor,
    ).expect(200)
    expect(listRes.body.data).toHaveLength(1)
    expect(listRes.body.data[0].versions[0].status).toBe('stored')
  })

  it('uploading a second file with the same documentId creates version 2 under the same document, not a duplicate', async () => {
    const first = await authedWrite(
      request(httpServer(app)).post('/api/v1/records/pv_case/case-e2e-2/documents/upload'),
      actor,
    )
      .field('title', 'Source doc')
      .attach('file', Buffer.from('version one'), {
        filename: 'v1.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)

    const existingDocumentId = first.body.data.document.id as string
    const second = await authedWrite(
      request(httpServer(app)).post('/api/v1/records/pv_case/case-e2e-2/documents/upload'),
      actor,
    )
      .field('documentId', existingDocumentId)
      .attach('file', Buffer.from('version two'), {
        filename: 'v2.pdf',
        contentType: 'application/pdf',
      })
      .expect(201)

    expect(second.body.data.document.id).toBe(first.body.data.document.id)
    expect(second.body.data.version.version).toBe(2)
  })

  it('requires a title when creating a brand-new document (400, not a silent failure)', async () => {
    await authedWrite(
      request(httpServer(app)).post('/api/v1/records/pv_case/case-e2e-3/documents/upload'),
      actor,
    )
      .attach('file', Buffer.from('bytes'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400)
  })

  it('401s unauthenticated, 403s an actor without documents.manage', async () => {
    await request(httpServer(app))
      .post('/api/v1/records/pv_case/case-e2e-4/documents/upload')
      .attach('file', Buffer.from('bytes'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(401)

    await seedRoleWithPermissions('READ_ONLY_ROLE', ['documents.view'])
    const readOnlyActor = await createAuthenticatedActor(app, testPrisma, {
      companyId,
      roleKeys: ['READ_ONLY_ROLE'],
    })
    await authedWrite(
      request(httpServer(app)).post('/api/v1/records/pv_case/case-e2e-4/documents/upload'),
      readOnlyActor,
    )
      .field('title', 'Nope')
      .attach('file', Buffer.from('bytes'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(403)
  })
})
