import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegConfigService } from './reg-config.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

/** Same fake-Prisma-with-passthrough-$transaction harness `CountryConfigService`'s own spec uses. */
function buildHarness() {
  const regulatoryRequirement = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const requiredDocumentDefinition = { createMany: jest.fn() }
  const regulatoryFeeSchedule = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }
  const regDeadlineRule = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  }

  const tables = {
    regulatoryRequirement,
    requiredDocumentDefinition,
    regulatoryFeeSchedule,
    regDeadlineRule,
  }
  const prisma = { ...tables, $transaction: (fn: (tx: typeof tables) => unknown) => fn(tables) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new RegConfigService(prisma as never, auditService)
  return { service, ...tables, auditLog }
}

describe('RegConfigService — regulatory requirements', () => {
  it('createRequirementVersion starts at version 1 and defaults unverified to true', async () => {
    const { service, regulatoryRequirement, requiredDocumentDefinition } = buildHarness()
    regulatoryRequirement.findFirst.mockResolvedValue(null)
    regulatoryRequirement.create.mockImplementation(({ data }: never) => Promise.resolve(data))
    regulatoryRequirement.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'req-1', documentDefinitions: [] }),
    )

    const created = await service.createRequirementVersion(
      actor,
      {
        countryId: 'ke',
        authorityId: 'ppb',
        productClass: 'generic_pharma',
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.id).toBe('req-1')
    expect(regulatoryRequirement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 1,
          status: 'draft',
          unverified: true,
          route: '*',
        }),
      }),
    )
    expect(requiredDocumentDefinition.createMany).not.toHaveBeenCalled()
  })

  it('createRequirementVersion increments past the highest existing version for the same (country, authority, class, route) key', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    regulatoryRequirement.findFirst.mockResolvedValue({ version: 2 })
    regulatoryRequirement.create.mockImplementation(({ data }: never) => Promise.resolve(data))
    regulatoryRequirement.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'req-2', documentDefinitions: [] }),
    )

    await service.createRequirementVersion(
      actor,
      {
        countryId: 'ke',
        authorityId: 'ppb',
        productClass: 'generic_pharma',
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(regulatoryRequirement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3 }) }),
    )
  })

  it('createRequirementVersion creates one RequiredDocumentDefinition row per checklist item, preserving order', async () => {
    const { service, regulatoryRequirement, requiredDocumentDefinition } = buildHarness()
    regulatoryRequirement.findFirst.mockResolvedValue(null)
    regulatoryRequirement.create.mockImplementation(({ data }: { data: { id: string } }) =>
      Promise.resolve(data),
    )
    regulatoryRequirement.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ id: 'req-3', documentDefinitions: [] }),
    )

    await service.createRequirementVersion(
      actor,
      {
        countryId: 'ke',
        authorityId: 'ppb',
        productClass: 'generic_pharma',
        effectiveFrom: '2026-01-01',
        documentDefinitions: [
          { documentKey: 'cpp', name: 'Certificate of Pharmaceutical Product' },
          { documentKey: 'gmp_certificate', name: 'GMP Certificate' },
        ],
      },
      {},
    )

    const generatedId = regulatoryRequirement.create.mock.calls[0][0].data.id as string
    expect(requiredDocumentDefinition.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          documentKey: 'cpp',
          sortOrder: 0,
          regulatoryRequirementId: generatedId,
        }),
        expect.objectContaining({
          documentKey: 'gmp_certificate',
          sortOrder: 1,
          regulatoryRequirementId: generatedId,
        }),
      ],
    })
  })

  it('activateRequirement refuses an unverified draft', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    regulatoryRequirement.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'draft',
      unverified: true,
    })

    await expect(service.activateRequirement(actor, 'req-1', {})).rejects.toMatchObject({
      response: { code: 'RULE_UNVERIFIED' },
    })
    expect(regulatoryRequirement.update).not.toHaveBeenCalled()
  })

  it('activateRequirement refuses a non-draft version', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    regulatoryRequirement.findUnique.mockResolvedValue({
      id: 'req-1',
      status: 'active',
      unverified: false,
    })

    await expect(service.activateRequirement(actor, 'req-1', {})).rejects.toMatchObject({
      response: { code: 'NOT_DRAFT' },
    })
  })

  it('activateRequirement retires the previously-active version for the same natural key and audits both sides', async () => {
    const { service, regulatoryRequirement, auditLog } = buildHarness()
    const target = {
      id: 'req-2',
      status: 'draft',
      unverified: false,
      countryId: 'ke',
      authorityId: 'ppb',
      productClass: 'generic_pharma',
      route: '*',
      version: 2,
    }
    regulatoryRequirement.findUnique.mockResolvedValue(target)
    regulatoryRequirement.findFirst.mockResolvedValue({ id: 'req-1', version: 1 })
    regulatoryRequirement.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...target, id: where.id, ...data }),
    )

    const activated = await service.activateRequirement(actor, 'req-2', {})

    expect(activated.status).toBe('active')
    expect(regulatoryRequirement.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'retired' },
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'regulatory_requirement_activated',
        oldValue: { activeVersionId: 'req-1', version: 1 },
      }),
    )
  })

  it('resolveRequirement returns the exact-route active row when one exists', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    const specific = { id: 'req-oral', route: 'oral' }
    regulatoryRequirement.findFirst.mockResolvedValueOnce(specific)

    const resolved = await service.resolveRequirement('ke', 'ppb', 'generic_pharma', 'oral')
    expect(resolved).toBe(specific)
    expect(regulatoryRequirement.findFirst).toHaveBeenCalledTimes(1)
  })

  it('resolveRequirement falls back to the "*" route sentinel when no route-specific row is active', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    const wildcard = { id: 'req-wild', route: '*' }
    regulatoryRequirement.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(wildcard)

    const resolved = await service.resolveRequirement('ke', 'ppb', 'generic_pharma', 'oral')
    expect(resolved).toBe(wildcard)
    expect(regulatoryRequirement.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ route: '*' }) }),
    )
  })

  it('resolveRequirement returns null when nothing active resolves at all — never throws, never guesses', async () => {
    const { service, regulatoryRequirement } = buildHarness()
    regulatoryRequirement.findFirst.mockResolvedValue(null)

    await expect(
      service.resolveRequirement('ke', 'ppb', 'unconfigured_class', '*'),
    ).resolves.toBeNull()
  })
})

describe('RegConfigService — fee schedules', () => {
  it('resolveFeeSchedules merges route-specific and "*" rows without double-counting a fee type present in both', async () => {
    const { service, regulatoryFeeSchedule } = buildHarness()
    regulatoryFeeSchedule.findMany
      .mockResolvedValueOnce([{ id: 'specific-application', feeType: 'application' }])
      .mockResolvedValueOnce([
        { id: 'wildcard-application', feeType: 'application' },
        { id: 'wildcard-renewal', feeType: 'renewal' },
      ])

    const resolved = await service.resolveFeeSchedules('ke', 'ppb', 'generic_pharma', 'oral')

    expect(resolved).toEqual([
      { id: 'specific-application', feeType: 'application' },
      { id: 'wildcard-renewal', feeType: 'renewal' },
    ])
  })
})

describe('RegConfigService — deadline rules', () => {
  it('createDeadlineRuleVersion defaults productClass to the "*" sentinel', async () => {
    const { service, regDeadlineRule } = buildHarness()
    regDeadlineRule.findFirst.mockResolvedValue(null)
    regDeadlineRule.create.mockImplementation(({ data }: never) => Promise.resolve(data))

    const created = await service.createDeadlineRuleVersion(
      actor,
      {
        countryId: 'ke',
        authorityId: 'ppb',
        obligationType: 'renewal',
        intervalValue: 5,
        intervalUnit: 'years',
        effectiveFrom: '2026-01-01',
      },
      {},
    )

    expect(created.productClass).toBe('*')
    expect(created.intervalUnit).toBe('years')
  })

  it('resolveDeadlineRule falls back to the "*" product-class sentinel', async () => {
    const { service, regDeadlineRule } = buildHarness()
    const wildcard = { id: 'rule-1', productClass: '*' }
    regDeadlineRule.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(wildcard)

    const resolved = await service.resolveDeadlineRule('ke', 'ppb', 'generic_pharma', 'renewal')
    expect(resolved).toBe(wildcard)
  })

  it('listDeadlineRules includes a "*" (all-classes) row when filtering by a specific class — regression, found via real browser verification: a rule created with "apply to every product class" checked used to vanish from its own creating screen\'s list', async () => {
    const { service, regDeadlineRule } = buildHarness()
    regDeadlineRule.findMany.mockResolvedValue([])
    regDeadlineRule.count.mockResolvedValue(0)

    await service.listDeadlineRules({
      countryId: 'ke',
      authorityId: 'ppb',
      productClass: 'generic_pharma',
      page: 1,
      limit: 25,
    })

    expect(regDeadlineRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ productClass: { in: ['generic_pharma', '*'] } }),
      }),
    )
  })
})
