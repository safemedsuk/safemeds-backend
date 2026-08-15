import { BadRequestException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DocumentsService } from './documents.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const documents = new Map<
    string,
    { id: string; companyId: string; recordType: string; recordId: string; title: string }
  >()
  const versions = new Map<
    string,
    {
      id: string
      documentId: string
      version: number
      status: string
      key: string
      sha256?: string
      sizeBytes?: number
    }
  >()

  type DocRow = {
    id: string
    companyId: string
    recordType: string
    recordId: string
    title: string
  }
  type VersionRow = {
    id: string
    documentId: string
    version: number
    status: string
    key: string
    sha256?: string
    sizeBytes?: number
  }

  const documentFindMany = jest
    .fn()
    .mockImplementation(
      ({ where }: { where: { companyId: string; recordType: string; recordId: string } }) =>
        Promise.resolve(
          [...documents.values()]
            .filter(
              (d) =>
                d.companyId === where.companyId &&
                d.recordType === where.recordType &&
                d.recordId === where.recordId,
            )
            .map((d) => ({
              ...d,
              versions: [...versions.values()]
                .filter((v) => v.documentId === d.id)
                .sort((a, b) => b.version - a.version),
            })),
        ),
    )
  const documentFindFirst = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: {
          id: string
          companyId: string
          recordType: string
          recordId: string
          include?: { versions?: { take?: number } }
        }
      }) => {
        const doc = documents.get(where.id)
        if (
          !doc ||
          doc.companyId !== where.companyId ||
          doc.recordType !== where.recordType ||
          doc.recordId !== where.recordId
        )
          return Promise.resolve(null)
        const docVersions = [...versions.values()]
          .filter((v) => v.documentId === doc.id)
          .sort((a, b) => b.version - a.version)
        return Promise.resolve({
          ...doc,
          versions: where.include?.versions?.take === 1 ? docVersions.slice(0, 1) : docVersions,
        })
      },
    )
  const documentCreate = jest.fn().mockImplementation(({ data }: { data: DocRow }) => {
    documents.set(data.id, data)
    return Promise.resolve(data)
  })

  const versionFindFirst = jest
    .fn()
    .mockImplementation(
      ({
        where,
      }: {
        where: { id: string; documentId: string; document?: { companyId: string } }
      }) => {
        const v = versions.get(where.id)
        if (!v || v.documentId !== where.documentId) return Promise.resolve(null)
        const doc = documents.get(v.documentId)
        if (where.document?.companyId && doc?.companyId !== where.document.companyId)
          return Promise.resolve(null)
        return Promise.resolve(v)
      },
    )
  const versionCreate = jest.fn().mockImplementation(({ data }: { data: VersionRow }) => {
    versions.set(data.id, data)
    return Promise.resolve(data)
  })
  const versionUpdate = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<VersionRow> }) => {
      const existing = versions.get(where.id)!
      const updated = { ...existing, ...data }
      versions.set(where.id, updated)
      return Promise.resolve(updated)
    })

  const tables = {
    document: { findMany: documentFindMany, findFirst: documentFindFirst, create: documentCreate },
    documentVersion: { findFirst: versionFindFirst, create: versionCreate, update: versionUpdate },
  }

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const presignUpload = jest.fn().mockResolvedValue('https://r2.example/upload')
  const verifyObject = jest.fn().mockResolvedValue({ sha256: 'abc123', sizeBytes: 42 })
  const presignDownload = jest.fn().mockResolvedValue('https://r2.example/download')
  const putObject = jest
    .fn()
    .mockImplementation((key: string, body: Buffer) =>
      Promise.resolve({ key, sha256: 'direct-sha256', sizeBytes: body.byteLength }),
    )
  const storage = { presignUpload, verifyObject, presignDownload, putObject }

  const configValues: Record<string, unknown> = {
    PRESIGNED_UPLOAD_TTL_SECONDS: 300,
    PRESIGNED_DOWNLOAD_TTL_SECONDS: 900,
    UPLOAD_MAX_FILE_SIZE_MB: 10,
  }
  const configService = { get: (key: string) => configValues[key] }

  const service = new DocumentsService(
    rls as never,
    storage as never,
    auditService,
    configService as never,
  )
  return { service, storage, documents, versions }
}

describe('DocumentsService', () => {
  it('createUploadIntent() creates a new Document + v1 when no documentId is given', async () => {
    const { service } = buildHarness()
    const result = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'psmf.pdf', contentType: 'application/pdf' },
      {},
    )

    expect(result.document.title).toBe('PSMF')
    expect(result.version.version).toBe(1)
    expect(result.version.status).toBe('pending')
    expect(result.uploadUrl).toBe('https://r2.example/upload')
    expect(result.maxSizeBytes).toBe(10 * 1024 * 1024)
  })

  it('createUploadIntent() requires a title when creating a new document', async () => {
    const { service } = buildHarness()
    await expect(
      service.createUploadIntent(
        actor,
        'company',
        'company-1',
        { filename: 'x.pdf', contentType: 'application/pdf' },
        {},
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('createUploadIntent() with an existing documentId creates version 2, not a second document', async () => {
    const { service } = buildHarness()
    const first = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'v1.pdf', contentType: 'application/pdf' },
      {},
    )
    const second = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { documentId: first.document.id, filename: 'v2.pdf', contentType: 'application/pdf' },
      {},
    )

    expect(second.document.id).toBe(first.document.id)
    expect(second.version.version).toBe(2)
  })

  it('completeUpload() verifies server-side and marks the version stored', async () => {
    const { service, storage } = buildHarness()
    const intent = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'psmf.pdf', contentType: 'application/pdf' },
      {},
    )

    const completed = await service.completeUpload(actor, intent.document.id, intent.version.id, {})

    expect(storage.verifyObject).toHaveBeenCalledWith(intent.version.key)
    expect(completed.status).toBe('stored')
    expect(completed.sha256).toBe('abc123')
    expect(completed.sizeBytes).toBe(42)
  })

  it('completeUpload() marks the version failed if the object was never actually uploaded', async () => {
    const { service, storage } = buildHarness()
    storage.verifyObject.mockRejectedValueOnce(new Error('NoSuchKey'))
    const intent = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'psmf.pdf', contentType: 'application/pdf' },
      {},
    )

    await expect(
      service.completeUpload(actor, intent.document.id, intent.version.id, {}),
    ).rejects.toThrow(BadRequestException)
  })

  it('getDownloadUrl() rejects a version that has not finished uploading', async () => {
    const { service } = buildHarness()
    const intent = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'psmf.pdf', contentType: 'application/pdf' },
      {},
    )

    await expect(
      service.getDownloadUrl(actor, intent.document.id, intent.version.id),
    ).rejects.toThrow(BadRequestException)
  })

  it('getDownloadUrl() succeeds once the version is stored', async () => {
    const { service } = buildHarness()
    const intent = await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'psmf.pdf', contentType: 'application/pdf' },
      {},
    )
    await service.completeUpload(actor, intent.document.id, intent.version.id, {})

    const { url } = await service.getDownloadUrl(actor, intent.document.id, intent.version.id)
    expect(url).toBe('https://r2.example/download')
  })

  it('listForRecord() returns only documents for that exact record, versions newest-first', async () => {
    const { service } = buildHarness()
    await service.createUploadIntent(
      actor,
      'facility',
      'facility-1',
      { title: 'Licence', filename: 'a.pdf', contentType: 'application/pdf' },
      {},
    )
    await service.createUploadIntent(
      actor,
      'company',
      'company-1',
      { title: 'PSMF', filename: 'b.pdf', contentType: 'application/pdf' },
      {},
    )

    const results = await service.listForRecord(actor, 'facility', 'facility-1')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Licence')
  })

  it('createUploadIntent() 404s on an unknown documentId', async () => {
    const { service } = buildHarness()
    await expect(
      service.createUploadIntent(
        actor,
        'company',
        'company-1',
        { documentId: 'nope', filename: 'x.pdf', contentType: 'application/pdf' },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })

  describe('uploadDirect()', () => {
    it('creates a new Document + a v1 DocumentVersion already in "stored" status — no pending window', async () => {
      const { service, storage } = buildHarness()
      const file = {
        buffer: Buffer.from('%PDF-1.4 fake pdf bytes'),
        originalname: 'source-report.pdf',
        mimetype: 'application/pdf',
      }

      const result = await service.uploadDirect(
        actor,
        'pv_case',
        'case-1',
        file,
        { title: 'Original report form' },
        {},
      )

      expect(storage.putObject).toHaveBeenCalledWith(
        expect.stringContaining('documents/company-1/'),
        file.buffer,
        'application/pdf',
      )
      expect(result.document.title).toBe('Original report form')
      expect(result.version.version).toBe(1)
      expect(result.version.status).toBe('stored')
      expect(result.version.sha256).toBe('direct-sha256')
      expect(result.version.sizeBytes).toBe(file.buffer.byteLength)
    })

    it('creates version 2 under an existing documentId rather than a second document', async () => {
      const { service } = buildHarness()
      const file1 = {
        buffer: Buffer.from('v1 bytes'),
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
      }
      const file2 = {
        buffer: Buffer.from('v2 bytes'),
        originalname: 'b.pdf',
        mimetype: 'application/pdf',
      }

      const first = await service.uploadDirect(
        actor,
        'pv_case',
        'case-1',
        file1,
        { title: 'Source doc' },
        {},
      )
      const second = await service.uploadDirect(
        actor,
        'pv_case',
        'case-1',
        file2,
        { documentId: first.document.id },
        {},
      )

      expect(second.document.id).toBe(first.document.id)
      expect(second.version.version).toBe(2)
    })

    it('requires a title when creating a brand-new document', async () => {
      const { service } = buildHarness()
      const file = {
        buffer: Buffer.from('bytes'),
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
      }
      await expect(service.uploadDirect(actor, 'pv_case', 'case-1', file, {}, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('404s on an unknown documentId', async () => {
      const { service } = buildHarness()
      const file = {
        buffer: Buffer.from('bytes'),
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
      }
      await expect(
        service.uploadDirect(actor, 'pv_case', 'case-1', file, { documentId: 'nope' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects a file over the configured size limit before ever touching storage', async () => {
      const { service, storage } = buildHarness()
      const oversized = {
        buffer: Buffer.alloc(11 * 1024 * 1024),
        originalname: 'huge.pdf',
        mimetype: 'application/pdf',
      }

      await expect(
        service.uploadDirect(actor, 'pv_case', 'case-1', oversized, { title: 'Too big' }, {}),
      ).rejects.toThrow(BadRequestException)
      expect(storage.putObject).not.toHaveBeenCalled()
    })

    it('the resulting version is immediately downloadable (status is already "stored")', async () => {
      const { service } = buildHarness()
      const file = {
        buffer: Buffer.from('bytes'),
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
      }
      const result = await service.uploadDirect(
        actor,
        'pv_case',
        'case-1',
        file,
        { title: 'Doc' },
        {},
      )

      const { url } = await service.getDownloadUrl(actor, result.document.id, result.version.id)
      expect(url).toBe('https://r2.example/download')
    })
  })
})
