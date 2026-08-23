import { ClassificationService } from './classification.service'

function buildHarness() {
  const authorityFindUnique = jest.fn().mockResolvedValue({ id: 'authority-1', countryId: 'ke' })
  const prisma = { regulatoryAuthority: { findUnique: authorityFindUnique } } as never

  const resolveRequirement = jest.fn()
  const resolveFeeSchedules = jest.fn().mockResolvedValue([])
  const resolveDeadlineRule = jest.fn().mockResolvedValue(null)
  const regConfigService = { resolveRequirement, resolveFeeSchedules, resolveDeadlineRule } as never

  const service = new ClassificationService(prisma, regConfigService)
  return {
    service,
    authorityFindUnique,
    resolveRequirement,
    resolveFeeSchedules,
    resolveDeadlineRule,
  }
}

describe('ClassificationService.classify', () => {
  it('derives countryId from the chosen authority rather than trusting a caller-supplied one', async () => {
    const { service, authorityFindUnique, resolveRequirement } = buildHarness()
    resolveRequirement.mockResolvedValue(null)

    await service.classify('authority-1', 'generic_pharma', '*')

    expect(authorityFindUnique).toHaveBeenCalledWith({ where: { id: 'authority-1' } })
    expect(resolveRequirement).toHaveBeenCalledWith('ke', 'authority-1', 'generic_pharma', '*')
  })

  it('404s when the authority does not resolve', async () => {
    const { service, authorityFindUnique } = buildHarness()
    authorityFindUnique.mockResolvedValue(null)

    await expect(service.classify('missing', 'generic_pharma', '*')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })

  it('warns when nothing resolves for this combination at all', async () => {
    const { service, resolveRequirement } = buildHarness()
    resolveRequirement.mockResolvedValue(null)

    const result = await service.classify('authority-1', 'unconfigured_class', '*')

    expect(result.requirement).toBeNull()
    expect(result.warnings).toEqual([
      'No document checklist is configured yet for this country/authority/product class — you can still start a dossier, but it will begin with zero pre-filled requirements.',
    ])
  })

  it('warns when the resolved requirement is unverified, without the "not configured" warning', async () => {
    const { service, resolveRequirement } = buildHarness()
    resolveRequirement.mockResolvedValue({ id: 'req-1', unverified: true, documentDefinitions: [] })

    const result = await service.classify('authority-1', 'generic_pharma', '*')

    expect(result.warnings).toEqual([
      'The document checklist shown has not yet been confirmed against a primary regulatory source.',
    ])
  })

  it('warns on an unverified fee schedule and an unverified renewal rule independently', async () => {
    const { service, resolveRequirement, resolveFeeSchedules, resolveDeadlineRule } = buildHarness()
    resolveRequirement.mockResolvedValue({
      id: 'req-1',
      unverified: false,
      documentDefinitions: [],
    })
    resolveFeeSchedules.mockResolvedValue([{ id: 'fee-1', unverified: true }])
    resolveDeadlineRule.mockResolvedValue({ id: 'rule-1', unverified: true })

    const result = await service.classify('authority-1', 'generic_pharma', '*')

    expect(result.warnings).toEqual([
      'One or more fee amounts shown are placeholder figures, not yet confirmed.',
      'The renewal cadence shown has not yet been confirmed.',
    ])
  })

  it('produces no warnings when everything resolved is confirmed', async () => {
    const { service, resolveRequirement, resolveFeeSchedules, resolveDeadlineRule } = buildHarness()
    resolveRequirement.mockResolvedValue({
      id: 'req-1',
      unverified: false,
      documentDefinitions: [],
    })
    resolveFeeSchedules.mockResolvedValue([{ id: 'fee-1', unverified: false }])
    resolveDeadlineRule.mockResolvedValue({ id: 'rule-1', unverified: false })

    const result = await service.classify('authority-1', 'generic_pharma', '*')

    expect(result.warnings).toEqual([])
  })
})
