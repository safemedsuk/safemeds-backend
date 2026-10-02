import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InspectionChecklistService } from './inspection-checklist.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const create = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))
  const findMany = jest.fn().mockResolvedValue([])
  const findUnique = jest.fn()
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve(data))

  const prisma = { inspectionChecklistTemplate: { create, findMany, findUnique, update } }

  const service = new InspectionChecklistService(prisma as never, auditService)
  return { service, auditLog, create, findMany, findUnique, update }
}

describe('InspectionChecklistService.create', () => {
  it('creates a new section with the given natural key', async () => {
    const { service, create } = buildHarness()

    await service.create(
      actor,
      { authorityId: 'authority-1', sectionKey: 'premises', title: 'Premises' },
      {},
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorityId: 'authority-1', sectionKey: 'premises', unverified: true }),
      }),
    )
  })

  it('translates a unique-constraint violation into a real 409', async () => {
    const { service, create } = buildHarness()
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'x' }),
    )

    await expect(
      service.create(actor, { authorityId: 'authority-1', sectionKey: 'premises', title: 'Premises' }, {}),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('InspectionChecklistService.update', () => {
  it('404s updating a section that does not exist', async () => {
    const { service, findUnique } = buildHarness()
    findUnique.mockResolvedValue(null)

    await expect(service.update(actor, 'ghost', { title: 'New title' }, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('never touches authorityId/sectionKey/mappedRecordType — only the descriptive fields', async () => {
    const { service, findUnique, update } = buildHarness()
    findUnique.mockResolvedValue({ id: 'section-1', authorityId: 'authority-1', sectionKey: 'premises' })

    await service.update(actor, 'section-1', { title: 'Premises & Environmental Controls', sortOrder: 2 }, {})

    expect(update).toHaveBeenCalledWith({
      where: { id: 'section-1' },
      data: {
        title: 'Premises & Environmental Controls',
        description: undefined,
        guidelineReference: undefined,
        sortOrder: 2,
        unverified: undefined,
        active: undefined,
      },
    })
  })
})
