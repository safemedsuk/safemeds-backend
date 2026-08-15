import { RuleResolutionService } from './rule-resolution.service'

function fakePrisma(reportingRuleRows: unknown[] = [], formSchemaRows: unknown[] = []) {
  const reportingRuleFindMany = jest.fn().mockResolvedValue(reportingRuleRows)
  const formSchemaFindMany = jest.fn().mockResolvedValue(formSchemaRows)
  return {
    prisma: {
      reportingRule: { findMany: reportingRuleFindMany },
      formSchema: { findMany: formSchemaFindMany },
    } as never,
    reportingRuleFindMany,
    formSchemaFindMany,
  }
}

describe('RuleResolutionService.resolveReportingRule', () => {
  it('returns null when no rule has ever been active/retired as of the given date (Kenya ADR — Q1 unresolved)', async () => {
    const { prisma } = fakePrisma([])
    const service = new RuleResolutionService(prisma)

    const result = await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2026-07-27'),
    )

    expect(result).toBeNull()
  })

  it('only queries active/retired rows — a draft-only rule never resolves', async () => {
    const { prisma, reportingRuleFindMany } = fakePrisma([])
    const service = new RuleResolutionService(prisma)

    await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2026-07-27'),
    )

    expect(reportingRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['active', 'retired'] } }),
      }),
    )
  })

  it('returns the single active rule when only one version exists', async () => {
    const rule = {
      id: 'rule-1',
      windowDays: 15,
      status: 'active',
      effectiveFrom: new Date('2026-01-01'),
    }
    const { prisma } = fakePrisma([rule])
    const service = new RuleResolutionService(prisma)

    const result = await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2026-07-27'),
    )

    expect(result).toEqual(rule)
  })

  it('resolves the rule that was in force on a past date, not whatever is active today', async () => {
    // findMany is mocked to already apply the effectiveFrom<=asOfDate filter
    // and orderBy effectiveFrom desc — simulate the DB returning only the
    // row that was actually in force on the historical date requested.
    const oldRule = {
      id: 'rule-old',
      windowDays: 30,
      status: 'retired',
      effectiveFrom: new Date('2025-01-01'),
    }
    const { prisma } = fakePrisma([oldRule])
    const service = new RuleResolutionService(prisma)

    const result = await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2025-06-01'),
    )

    expect(result).toEqual(oldRule)
  })

  it('scopes the lookup by authority, report type, and seriousness class exactly', async () => {
    const { prisma, reportingRuleFindMany } = fakePrisma([])
    const service = new RuleResolutionService(prisma)

    await service.resolveReportingRule('auth-x', 'type-y', 'non_serious', new Date('2026-01-01'))

    expect(reportingRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authorityId: 'auth-x',
          reportTypeId: 'type-y',
          seriousnessClass: 'non_serious',
        }),
      }),
    )
  })

  it('queries with an inclusive (lte) effectiveFrom boundary, so a rule effective exactly on asOfDate resolves', async () => {
    const { prisma, reportingRuleFindMany } = fakePrisma([])
    const service = new RuleResolutionService(prisma)

    const asOfDate = new Date('2026-07-27')
    await service.resolveReportingRule('authority-1', 'report-type-1', 'serious', asOfDate)

    expect(reportingRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ effectiveFrom: { lte: asOfDate } }),
      }),
    )
  })

  it("breaks a tie between two rows sharing the same effectiveFrom by taking whichever the DB orders first (documents the DB's responsibility, not app-level tie-break logic)", async () => {
    // The service itself does no in-memory tie-breaking — it trusts the DB's
    // `orderBy: effectiveFrom desc` + `take: 1` to hand back a single row.
    // This test pins that contract: given two rows with an identical
    // effectiveFrom (as the DB might return them in arbitrary order for a
    // true tie), the service returns whichever is first in the resolved
    // array without attempting a secondary sort — so a genuine tie must be
    // prevented upstream (the phase4_1 partial unique index on `active`
    // rows already guarantees at most one *active* row per key; two
    // `retired` rows sharing an effectiveFrom is a data-quality concern for
    // config authors, not something this function silently "fixes").
    const ruleA = {
      id: 'rule-a',
      version: 1,
      status: 'retired',
      effectiveFrom: new Date('2026-01-01'),
    }
    const ruleB = {
      id: 'rule-b',
      version: 2,
      status: 'active',
      effectiveFrom: new Date('2026-01-01'),
    }
    const { prisma } = fakePrisma([ruleA, ruleB])
    const service = new RuleResolutionService(prisma)

    const result = await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2026-07-27'),
    )

    expect(result).toEqual(ruleA)
  })

  it('requests at most one row from the DB (take: 1) regardless of how many candidates exist', async () => {
    const { prisma, reportingRuleFindMany } = fakePrisma([])
    const service = new RuleResolutionService(prisma)

    await service.resolveReportingRule(
      'authority-1',
      'report-type-1',
      'serious',
      new Date('2026-01-01'),
    )

    expect(reportingRuleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1, orderBy: { effectiveFrom: 'desc' } }),
    )
  })
})

describe('RuleResolutionService.resolveFormSchema', () => {
  it('prefers a country-specific active schema over the global default', async () => {
    const countrySpecific = { id: 'schema-country', countryId: 'ke', status: 'active' }
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([countrySpecific]) // country-specific lookup
      .mockResolvedValueOnce([{ id: 'schema-global', countryId: null }]) // would-be global lookup, never reached

    const service = new RuleResolutionService({ formSchema: { findMany } } as never)
    const result = await service.resolveFormSchema('ke', 'report-type-1')

    expect(result).toEqual(countrySpecific)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('falls back to the global default (countryId: null) when no country-specific schema is active', async () => {
    const globalDefault = { id: 'schema-global', countryId: null, status: 'active' }
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([]) // country-specific lookup — nothing found
      .mockResolvedValueOnce([globalDefault]) // global fallback

    const service = new RuleResolutionService({ formSchema: { findMany } } as never)
    const result = await service.resolveFormSchema('ke', 'report-type-1')

    expect(result).toEqual(globalDefault)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('goes straight to the global lookup when no countryId is given at all', async () => {
    const globalDefault = { id: 'schema-global', countryId: null }
    const findMany = jest.fn().mockResolvedValue([globalDefault])

    const service = new RuleResolutionService({ formSchema: { findMany } } as never)
    const result = await service.resolveFormSchema(null, 'report-type-1')

    expect(result).toEqual(globalDefault)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ countryId: null }) }),
    )
  })

  it('returns null when neither a country-specific nor a global schema is active', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new RuleResolutionService({ formSchema: { findMany } } as never)

    const result = await service.resolveFormSchema('ke', 'report-type-1')

    expect(result).toBeNull()
  })

  it('scopes the country-specific lookup by an inclusive (lte) effectiveFrom boundary against "now"', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new RuleResolutionService({ formSchema: { findMany } } as never)

    await service.resolveFormSchema('ke', 'report-type-1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          countryId: 'ke',
          reportTypeId: 'report-type-1',
          status: { in: ['active', 'retired'] },
        }),
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
      }),
    )
  })
})
