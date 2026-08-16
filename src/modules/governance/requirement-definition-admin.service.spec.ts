import { Prisma } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RequirementDefinitionAdminService } from './requirement-definition-admin.service'

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
  const auditRequirementDefinition = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const prisma = { auditRequirementDefinition }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new RequirementDefinitionAdminService(prisma as never, auditService)
  return { service, auditRequirementDefinition, auditLog }
}

describe('RequirementDefinitionAdminService', () => {
  it('list() orders by authority then sortOrder', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.findMany.mockResolvedValue([])

    await service.list()

    expect(auditRequirementDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ authorityId: 'asc' }, { sortOrder: 'asc' }] }),
    )
  })

  it('create() only ever accepts source: person_uploads at the DTO level — the class-validator @IsIn on the DTO itself is the real enforcement, this just confirms a person_uploads row round-trips cleanly', async () => {
    const { service, auditRequirementDefinition, auditLog } = buildHarness()
    auditRequirementDefinition.create.mockImplementation(({ data }) => Promise.resolve(data))

    const created = await service.create(
      actor,
      {
        authorityId: 'auth-1',
        requirementKey: 'new_row',
        sortOrder: 16,
        title: 'A new requirement',
        description: 'Field-expert-identified requirement not in the original 15.',
        guidelineReference: 'GUD/099 §1.1',
        source: 'person_uploads',
        evidenceArtifactType: 'Document',
      },
      {},
    )

    expect(created.source).toBe('person_uploads')
    expect(created.active).toBe(true)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'audit_requirement_definition_created' }),
    )
  })

  it('create() surfaces a real conflict error when (authorityId, requirementKey) already exists', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.create.mockRejectedValue(uniqueConstraintError())

    await expect(
      service.create(
        actor,
        {
          authorityId: 'auth-1',
          requirementKey: 'qppv_nomination',
          sortOrder: 1,
          title: 'Dup',
          description: 'Dup',
          source: 'person_uploads',
          evidenceArtifactType: 'X',
        },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'REQUIREMENT_ALREADY_EXISTS' } })
  })

  it('update() 404s for a definition that does not exist', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.findUnique.mockResolvedValue(null)

    await expect(service.update(actor, 'missing', { title: 'X' }, {})).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('update() never touches source or requirementKey — only descriptive fields are in the DTO/data payload at all', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.findUnique.mockResolvedValue({
      id: 'd1',
      source: 'system_generated',
      requirementKey: 'psmf_in_place',
    })
    auditRequirementDefinition.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'd1', ...data }),
    )

    await service.update(
      actor,
      'd1',
      { title: 'Updated title', guidelineReference: 'GUD/022 §6.6' },
      {},
    )

    const callArgs = auditRequirementDefinition.update.mock.calls[0][0]
    expect(callArgs.data).not.toHaveProperty('source')
    expect(callArgs.data).not.toHaveProperty('requirementKey')
    expect(callArgs.data.title).toBe('Updated title')
    expect(callArgs.data.guidelineReference).toBe('GUD/022 §6.6')
  })

  it('update() clears guidelineReference back to null when given an empty string', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.findUnique.mockResolvedValue({
      id: 'd1',
      guidelineReference: 'GUD/022 §6.6',
    })
    auditRequirementDefinition.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'd1', ...data }),
    )

    const updated = await service.update(actor, 'd1', { guidelineReference: '' }, {})

    expect(updated.guidelineReference).toBeNull()
  })

  it('update() can deactivate a row (soft-delete, never a hard delete) via the active flag', async () => {
    const { service, auditRequirementDefinition } = buildHarness()
    auditRequirementDefinition.findUnique.mockResolvedValue({ id: 'd1', active: true })
    auditRequirementDefinition.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'd1', ...data }),
    )

    const updated = await service.update(actor, 'd1', { active: false }, {})

    expect(updated.active).toBe(false)
  })
})
