import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ProductClassService } from './product-class.service'

const platformActor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function buildHarness() {
  const productClassDefinition = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const prisma = { productClassDefinition }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new ProductClassService(prisma as never, auditService)
  return { service, productClassDefinition, auditLog }
}

describe('ProductClassService', () => {
  describe('list()', () => {
    it('always includes the generic (authorityId: null) rows alongside any authority-specific ones', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findMany.mockResolvedValue([])

      await service.list('ppb-authority-id')

      expect(productClassDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ authorityId: null }, { authorityId: 'ppb-authority-id' }],
          }),
        }),
      )
    })

    it('omits the authority filter entirely when no authorityId is given', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findMany.mockResolvedValue([])

      await service.list()

      expect(productClassDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ authorityId: null }] }),
        }),
      )
    })

    it('defaults to active-only unless includeInactive is set', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findMany.mockResolvedValue([])

      await service.list('ppb-authority-id')
      expect(productClassDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
      )

      await service.list('ppb-authority-id', true)
      expect(productClassDefinition.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ active: true }) }),
      )
    })
  })

  describe('create()', () => {
    it('creates an authority-scoped class and audits it', async () => {
      const { service, productClassDefinition, auditLog } = buildHarness()
      productClassDefinition.findFirst.mockResolvedValue(null)
      productClassDefinition.create.mockImplementation(({ data }) => Promise.resolve(data))

      const created = await service.create(
        platformActor,
        { authorityId: 'ppb-id', classKey: 'medicines', label: 'Medicines' },
        {},
      )

      expect(created.authorityId).toBe('ppb-id')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'product_class_created' }),
      )
    })

    it('creates a generic (authorityId: null) class when no authorityId is given', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findFirst.mockResolvedValue(null)
      productClassDefinition.create.mockImplementation(({ data }) => Promise.resolve(data))

      const created = await service.create(platformActor, { classKey: 'other', label: 'Other' }, {})

      expect(created.authorityId).toBeNull()
    })

    it('rejects a duplicate (authorityId, classKey) pair with CONFLICT — enforced in the service since the DB has no unique index across a nullable column', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findFirst.mockResolvedValue({
        id: 'existing',
        authorityId: 'ppb-id',
        classKey: 'medicines',
      })

      await expect(
        service.create(
          platformActor,
          { authorityId: 'ppb-id', classKey: 'medicines', label: 'Dup' },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('update()', () => {
    it('updates label/description/sortOrder/active and audits the change', async () => {
      const { service, productClassDefinition, auditLog } = buildHarness()
      const existing = {
        id: 'pc1',
        authorityId: 'ppb-id',
        classKey: 'medicines',
        label: 'Medicines',
        sortOrder: 1,
        active: true,
      }
      productClassDefinition.findUnique.mockResolvedValue(existing)
      productClassDefinition.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data }),
      )

      const updated = await service.update(
        platformActor,
        'pc1',
        { label: 'Medicines (Human Use)', active: false },
        {},
      )

      expect(updated.label).toBe('Medicines (Human Use)')
      expect(updated.active).toBe(false)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'product_class_updated' }),
      )
    })

    it('404s on an unknown id', async () => {
      const { service, productClassDefinition } = buildHarness()
      productClassDefinition.findUnique.mockResolvedValue(null)

      await expect(service.update(platformActor, 'missing', { label: 'X' }, {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
