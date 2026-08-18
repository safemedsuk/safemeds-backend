import { MeddraService } from './meddra.service'

function buildHarness() {
  const versionFindUnique = jest.fn()
  const versionFindFirst = jest.fn()
  const termFindMany = jest.fn().mockResolvedValue([])
  const prisma = {
    meddraVersion: { findUnique: versionFindUnique, findFirst: versionFindFirst },
    meddraTerm: { findMany: termFindMany },
  }
  const service = new MeddraService(prisma as never)
  return { service, versionFindUnique, versionFindFirst, termFindMany }
}

describe('MeddraService.search', () => {
  it('resolves the requested version by label when given one', async () => {
    const { service, versionFindUnique, versionFindFirst } = buildHarness()
    versionFindUnique.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'rash', version: 'MOCK-27.0' })

    expect(versionFindUnique).toHaveBeenCalledWith({ where: { versionLabel: 'MOCK-27.0' } })
    expect(versionFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to the most recently released version when none is specified', async () => {
    const { service, versionFindFirst } = buildHarness()
    versionFindFirst.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'rash' })

    expect(versionFindFirst).toHaveBeenCalledWith({ orderBy: { releasedOn: 'desc' } })
  })

  it('returns an empty array when no MedDRA version exists yet', async () => {
    const { service, versionFindFirst, termFindMany } = buildHarness()
    versionFindFirst.mockResolvedValue(null)

    const result = await service.search({ q: 'rash' })

    expect(result).toEqual([])
    expect(termFindMany).not.toHaveBeenCalled()
  })

  it('searches by name (case-insensitive contains) scoped to the resolved version, optionally filtered by level', async () => {
    const { service, versionFindFirst, termFindMany } = buildHarness()
    versionFindFirst.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'rash', level: 'PT' })

    expect(termFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { versionId: 'v1', name: { contains: 'rash', mode: 'insensitive' }, level: 'PT' },
        take: 20,
      }),
    )
  })
})
