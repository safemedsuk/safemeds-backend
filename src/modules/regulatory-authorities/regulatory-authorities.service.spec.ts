import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegulatoryAuthoritiesService } from './regulatory-authorities.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.5.0',
  })
}

function buildHarness() {
  const regulatoryAuthority = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const prisma = { regulatoryAuthority }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const putObject = jest.fn().mockResolvedValue({ key: 'k', sha256: 'h', sizeBytes: 1 })
  const storageService = { putObject } as never

  const service = new RegulatoryAuthoritiesService(prisma as never, auditService, storageService)
  return { service, regulatoryAuthority, auditLog, putObject }
}

describe('RegulatoryAuthoritiesService', () => {
  it('list() returns every authority when no countryId filter is given', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])

    const result = await service.list()

    expect(result).toHaveLength(2)
    expect(regulatoryAuthority.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    )
  })

  it('list() filters by countryId when given', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.findMany.mockResolvedValue([])

    await service.list('country-1')

    expect(regulatoryAuthority.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { countryId: 'country-1' } }),
    )
  })

  it('getAvailableEmblemAssetKeys() returns the real bundled keys, including the seeded Kenya one', () => {
    const { service } = buildHarness()

    const keys = service.getAvailableEmblemAssetKeys()

    expect(keys).toContain('kenya-coat-of-arms')
  })

  it('create() rejects an emblemAssetKey that has no matching bundled asset file', async () => {
    const { service } = buildHarness()

    await expect(
      service.create(
        actor,
        { countryId: 'c1', code: 'XYZ', name: 'Test Authority', emblemAssetKey: 'does-not-exist' },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'EMBLEM_ASSET_NOT_FOUND' } })
  })

  it('create() succeeds without an emblemAssetKey and audits the creation — this is the entire mechanism for bringing a new country online', async () => {
    const { service, regulatoryAuthority, auditLog } = buildHarness()
    regulatoryAuthority.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.create(
      actor,
      { countryId: 'country-uganda', code: 'NDA2', name: 'National Drug Authority' },
      {},
    )

    expect(created.countryId).toBe('country-uganda')
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'regulatory_authority_created' }),
    )
  })

  it('create() surfaces a real conflict error when the (countryId, code) pair already exists', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.create.mockRejectedValue(uniqueConstraintError())

    await expect(
      service.create(actor, { countryId: 'c1', code: 'PPB', name: 'Dup' }, {}),
    ).rejects.toMatchObject({
      response: { code: 'AUTHORITY_ALREADY_EXISTS' },
    })
  })

  it('update() 404s for an authority that does not exist', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.findUnique.mockResolvedValue(null)

    await expect(service.update(actor, 'missing', { name: 'X' }, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('update() clears emblemAssetKey back to null when given an empty string', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.findUnique.mockResolvedValue({
      id: 'a1',
      emblemAssetKey: 'kenya-coat-of-arms',
    })
    regulatoryAuthority.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'a1', ...data }),
    )

    const updated = await service.update(actor, 'a1', { emblemAssetKey: '' }, {})

    expect(updated.emblemAssetKey).toBeNull()
  })

  it('update() rejects a new emblemAssetKey that does not exist as a bundled asset', async () => {
    const { service, regulatoryAuthority } = buildHarness()
    regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1' })

    await expect(
      service.update(actor, 'a1', { emblemAssetKey: 'not-real' }, {}),
    ).rejects.toMatchObject({
      response: { code: 'EMBLEM_ASSET_NOT_FOUND' },
    })
  })

  it('update() audits both the old and new value', async () => {
    const { service, regulatoryAuthority, auditLog } = buildHarness()
    regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1', name: 'Old Name' })
    regulatoryAuthority.update.mockResolvedValue({ id: 'a1', name: 'New Name' })

    await service.update(actor, 'a1', { name: 'New Name' }, {})

    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'regulatory_authority_updated',
        oldValue: expect.objectContaining({ name: 'Old Name' }),
        newValue: expect.objectContaining({ name: 'New Name' }),
      }),
    )
  })

  // Real-usage feedback, 19 Aug 2026 — the per-authority admin-upload
  // path replacing "bundled assets only, an engineer must add the file."
  describe('uploadEmblem()', () => {
    const pngFile = {
      buffer: Buffer.from('fake-png-bytes'),
      originalname: 'emblem.png',
      mimetype: 'image/png',
    }

    it('uploads a PNG, stores the resulting object key, and audits it', async () => {
      const { service, regulatoryAuthority, putObject, auditLog } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1', emblemObjectKey: null })
      regulatoryAuthority.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'a1', ...data }),
      )

      const updated = await service.uploadEmblem(actor, 'a1', pngFile, {})

      expect(putObject).toHaveBeenCalledWith(
        expect.stringContaining('regulatory-authorities/a1/emblem-'),
        pngFile.buffer,
        'image/png',
      )
      expect(updated.emblemObjectKey).toEqual(
        expect.stringContaining('regulatory-authorities/a1/emblem-'),
      )
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'regulatory_authority_emblem_uploaded' }),
      )
    })

    it('accepts a JPEG too', async () => {
      const { service, regulatoryAuthority } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1', emblemObjectKey: null })
      regulatoryAuthority.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'a1', ...data }),
      )

      const updated = await service.uploadEmblem(
        actor,
        'a1',
        { ...pngFile, mimetype: 'image/jpeg', originalname: 'emblem.jpg' },
        {},
      )

      expect(updated.emblemObjectKey).toEqual(expect.stringContaining('.jpg'))
    })

    it('rejects a non-image content type', async () => {
      const { service, regulatoryAuthority } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1' })

      await expect(
        service.uploadEmblem(actor, 'a1', { ...pngFile, mimetype: 'application/pdf' }, {}),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_EMBLEM_TYPE' },
      })
    })

    it('rejects a file over the 2MB cap', async () => {
      const { service, regulatoryAuthority } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue({ id: 'a1' })

      await expect(
        service.uploadEmblem(
          actor,
          'a1',
          { ...pngFile, buffer: Buffer.alloc(3 * 1024 * 1024) },
          {},
        ),
      ).rejects.toMatchObject({
        response: { code: 'EMBLEM_TOO_LARGE' },
      })
    })

    it('404s on an unknown authority', async () => {
      const { service, regulatoryAuthority } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue(null)

      await expect(service.uploadEmblem(actor, 'nonexistent', pngFile, {})).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      })
    })
  })

  describe('removeEmblem()', () => {
    it('clears emblemObjectKey and audits it', async () => {
      const { service, regulatoryAuthority, auditLog } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue({
        id: 'a1',
        emblemObjectKey: 'regulatory-authorities/a1/emblem-123.png',
      })
      regulatoryAuthority.update.mockResolvedValue({ id: 'a1', emblemObjectKey: null })

      const updated = await service.removeEmblem(actor, 'a1', {})

      expect(updated.emblemObjectKey).toBeNull()
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'regulatory_authority_emblem_removed' }),
      )
    })

    it('404s on an unknown authority', async () => {
      const { service, regulatoryAuthority } = buildHarness()
      regulatoryAuthority.findUnique.mockResolvedValue(null)

      await expect(service.removeEmblem(actor, 'nonexistent', {})).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      })
    })
  })
})
