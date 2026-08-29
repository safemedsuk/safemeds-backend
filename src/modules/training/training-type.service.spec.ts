import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { TrainingTypeService } from './training-type.service'

const platformActor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}
const tenantActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const trainingTypeCatalogEntry = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const company = { findUnique: jest.fn() }
  const prisma = { trainingTypeCatalogEntry, company }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new TrainingTypeService(prisma as never, auditService)
  return { service, trainingTypeCatalogEntry, company, auditLog }
}

describe('TrainingTypeService', () => {
  describe('list()', () => {
    it("resolves countryId from the actor's own company home country when not explicitly passed", async () => {
      const { service, trainingTypeCatalogEntry, company } = buildHarness()
      company.findUnique.mockResolvedValue({ homeCountryId: 'kenya-id' })
      trainingTypeCatalogEntry.findMany.mockResolvedValue([])

      await service.list(tenantActor)

      expect(company.findUnique).toHaveBeenCalledWith({ where: { id: 'company-1' } })
      expect(trainingTypeCatalogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: [{ countryId: null }, { countryId: 'kenya-id' }] }),
        }),
      )
    })

    it("an explicit countryId always wins over the actor's own home country", async () => {
      const { service, trainingTypeCatalogEntry, company } = buildHarness()
      trainingTypeCatalogEntry.findMany.mockResolvedValue([])

      await service.list(platformActor, 'explicit-country-id')

      expect(company.findUnique).not.toHaveBeenCalled()
      expect(trainingTypeCatalogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ countryId: null }, { countryId: 'explicit-country-id' }],
          }),
        }),
      )
    })

    it('defaults to active-only unless includeInactive is set', async () => {
      const { service, trainingTypeCatalogEntry } = buildHarness()
      trainingTypeCatalogEntry.findMany.mockResolvedValue([])

      await service.list(platformActor, 'country-1')
      expect(trainingTypeCatalogEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
      )

      await service.list(platformActor, 'country-1', true)
      expect(trainingTypeCatalogEntry.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ active: true }) }),
      )
    })
  })

  describe('create()', () => {
    it('creates a country-scoped entry and audits it', async () => {
      const { service, trainingTypeCatalogEntry, auditLog } = buildHarness()
      trainingTypeCatalogEntry.findFirst.mockResolvedValue(null)
      trainingTypeCatalogEntry.create.mockImplementation(({ data }) => Promise.resolve(data))

      const created = await service.create(
        platformActor,
        { countryId: 'kenya-id', typeKey: 'gvp_certificate', label: 'GVP Certificate' },
        {},
      )

      expect(created.countryId).toBe('kenya-id')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'training_type_created' }),
      )
    })

    it('creates a generic (countryId: null) entry when no countryId is given', async () => {
      const { service, trainingTypeCatalogEntry } = buildHarness()
      trainingTypeCatalogEntry.findFirst.mockResolvedValue(null)
      trainingTypeCatalogEntry.create.mockImplementation(({ data }) => Promise.resolve(data))

      const created = await service.create(platformActor, { typeKey: 'other', label: 'Other' }, {})

      expect(created.countryId).toBeNull()
    })

    it('rejects a duplicate (countryId, typeKey) pair with CONFLICT — enforced in the service since the DB has no unique index across a nullable column', async () => {
      const { service, trainingTypeCatalogEntry } = buildHarness()
      trainingTypeCatalogEntry.findFirst.mockResolvedValue({
        id: 'existing',
        countryId: 'kenya-id',
        typeKey: 'gvp_certificate',
      })

      await expect(
        service.create(
          platformActor,
          { countryId: 'kenya-id', typeKey: 'gvp_certificate', label: 'Dup' },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('update()', () => {
    it('updates label/sortOrder/active and audits the change', async () => {
      const { service, trainingTypeCatalogEntry, auditLog } = buildHarness()
      const existing = {
        id: 't1',
        countryId: 'kenya-id',
        typeKey: 'gvp_certificate',
        label: 'GVP Certificate',
        sortOrder: 1,
        active: true,
      }
      trainingTypeCatalogEntry.findUnique.mockResolvedValue(existing)
      trainingTypeCatalogEntry.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existing, ...data }),
      )

      const updated = await service.update(
        platformActor,
        't1',
        { label: 'GVP Certificate (Renewed)', active: false },
        {},
      )

      expect(updated.label).toBe('GVP Certificate (Renewed)')
      expect(updated.active).toBe(false)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'training_type_updated' }),
      )
    })

    it('404s on an unknown id', async () => {
      const { service, trainingTypeCatalogEntry } = buildHarness()
      trainingTypeCatalogEntry.findUnique.mockResolvedValue(null)

      await expect(service.update(platformActor, 'missing', { label: 'X' }, {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
