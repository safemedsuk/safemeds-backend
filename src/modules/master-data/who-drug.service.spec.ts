import { WhoDrugService } from './who-drug.service'

function buildHarness() {
  const versionFindUnique = jest.fn()
  const versionFindFirst = jest.fn()
  const termFindMany = jest.fn().mockResolvedValue([])
  const prisma = {
    whoDrugVersion: { findUnique: versionFindUnique, findFirst: versionFindFirst },
    whoDrugTerm: { findMany: termFindMany },
  }
  const service = new WhoDrugService(prisma as never)
  return { service, versionFindUnique, versionFindFirst, termFindMany }
}

describe('WhoDrugService.search', () => {
  it('resolves the requested version by label when given one', async () => {
    const { service, versionFindUnique, versionFindFirst } = buildHarness()
    versionFindUnique.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'panadol', version: 'MOCK-B3-2026.1' })

    expect(versionFindUnique).toHaveBeenCalledWith({ where: { versionLabel: 'MOCK-B3-2026.1' } })
    expect(versionFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to the most recently released version when none is specified', async () => {
    const { service, versionFindFirst } = buildHarness()
    versionFindFirst.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'panadol' })

    expect(versionFindFirst).toHaveBeenCalledWith({ orderBy: { releasedOn: 'desc' } })
  })

  it('returns an empty array when no WHODrug version exists yet', async () => {
    const { service, versionFindFirst, termFindMany } = buildHarness()
    versionFindFirst.mockResolvedValue(null)

    const result = await service.search({ q: 'panadol' })

    expect(result).toEqual([])
    expect(termFindMany).not.toHaveBeenCalled()
  })

  it('searches by name OR substance name (case-insensitive contains), scoped to the resolved version', async () => {
    const { service, versionFindFirst, termFindMany } = buildHarness()
    versionFindFirst.mockResolvedValue({ id: 'v1' })

    await service.search({ q: 'paracetamol' })

    expect(termFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          versionId: 'v1',
          OR: [
            { name: { contains: 'paracetamol', mode: 'insensitive' } },
            { substanceName: { contains: 'paracetamol', mode: 'insensitive' } },
          ],
        },
        take: 20,
      }),
    )
  })
})
