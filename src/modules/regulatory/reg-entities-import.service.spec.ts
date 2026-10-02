import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegEntitiesImportService } from './reg-entities-import.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const countryFindFirst = jest.fn().mockResolvedValue(null)
  const tables = { country: { findFirst: countryFindFirst } }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const findManufacturerByName = jest.fn().mockResolvedValue(null)
  const createManufacturer = jest.fn().mockImplementation((_actor, dto) => Promise.resolve({ id: `mfg-${dto.name}`, ...dto }))
  const createManufacturingSite = jest.fn().mockImplementation((_actor, dto) => Promise.resolve({ id: `site-${dto.siteName}`, ...dto }))
  const createLocalRepresentative = jest.fn().mockImplementation((_actor, dto) => Promise.resolve({ id: `rep-${dto.name}`, ...dto }))
  const regEntitiesService = {
    findManufacturerByName,
    createManufacturer,
    createManufacturingSite,
    createLocalRepresentative,
  } as never

  const service = new RegEntitiesImportService(rls as never, auditService, regEntitiesService)
  return {
    service,
    auditLog,
    countryFindFirst,
    findManufacturerByName,
    createManufacturer,
    createManufacturingSite,
    createLocalRepresentative,
  }
}

describe('RegEntitiesImportService.preview', () => {
  it('splits manufacturer rows into valid/invalid, flagging a missing key and a missing name', async () => {
    const { service } = buildHarness()
    const csv = 'manufacturerKey,name\nMFG-001,Acme Pharma\n,No Key Co\nMFG-002,'

    const preview = await service.preview(actor, { manufacturersCsv: csv })

    expect(preview.manufacturers.totalRows).toBe(3)
    expect(preview.manufacturers.validRows).toHaveLength(1)
    expect(preview.manufacturers.validRows[0].data.manufacturerKey).toBe('MFG-001')
    expect(preview.manufacturers.invalidRows).toHaveLength(2)
    expect(preview.manufacturers.invalidRows[0].errors).toContain('Manufacturer Key is required')
    expect(preview.manufacturers.invalidRows[1].errors).toContain('Manufacturer Name is required')
  })

  it('flags a duplicate manufacturerKey within the same file', async () => {
    const { service } = buildHarness()
    const csv = 'manufacturerKey,name\nMFG-001,Acme Pharma\nMFG-001,Acme Pharma Two'

    const preview = await service.preview(actor, { manufacturersCsv: csv })

    expect(preview.manufacturers.validRows).toHaveLength(1)
    expect(preview.manufacturers.invalidRows).toHaveLength(1)
    expect(preview.manufacturers.invalidRows[0].errors[0]).toMatch(/Duplicate Manufacturer Key/)
  })

  it('remaps a real spreadsheet header alias (e.g. "Manufacturer") onto the canonical key', async () => {
    const { service } = buildHarness()
    const csv = 'Key,Manufacturer\nMFG-001,Acme Pharma'

    const preview = await service.preview(actor, { manufacturersCsv: csv })

    expect(preview.manufacturers.validRows).toHaveLength(1)
    expect(preview.manufacturers.validRows[0].data).toMatchObject({ manufacturerKey: 'MFG-001', name: 'Acme Pharma' })
  })

  it('resolves a site row\'s manufacturerKey against the manufacturers file in the same batch', async () => {
    const { service } = buildHarness()
    const preview = await service.preview(actor, {
      manufacturersCsv: 'manufacturerKey,name\nMFG-001,Acme Pharma',
      sitesCsv: 'manufacturerKey,siteName\nMFG-001,Nairobi Plant',
    })

    expect(preview.sites.validRows).toHaveLength(1)
  })

  it('falls back to a live existing-manufacturer name match when the key is not in the uploaded manufacturers file', async () => {
    const { service, findManufacturerByName } = buildHarness()
    findManufacturerByName.mockResolvedValue({ id: 'mfg-existing', name: 'Already Cataloged Co' })

    const preview = await service.preview(actor, {
      sitesCsv: 'manufacturerKey,siteName\nAlready Cataloged Co,Second Site',
    })

    expect(findManufacturerByName).toHaveBeenCalledWith(actor, 'Already Cataloged Co')
    expect(preview.sites.validRows).toHaveLength(1)
  })

  it('flags a site row whose manufacturerKey resolves nowhere — not in this batch, not in the existing catalog', async () => {
    const { service, findManufacturerByName } = buildHarness()
    findManufacturerByName.mockResolvedValue(null)

    const preview = await service.preview(actor, {
      sitesCsv: 'manufacturerKey,siteName\nGhost Co,Some Site',
    })

    expect(preview.sites.invalidRows).toHaveLength(1)
    expect(preview.sites.invalidRows[0].errors[0]).toMatch(/does not match any manufacturer/)
  })

  it('flags an invalid GMP certificate expiry date on a site row', async () => {
    const { service } = buildHarness()
    const preview = await service.preview(actor, {
      manufacturersCsv: 'manufacturerKey,name\nMFG-001,Acme Pharma',
      sitesCsv: 'manufacturerKey,siteName,gmpCertificateExpiresOn\nMFG-001,Plant,not-a-date',
    })

    expect(preview.sites.invalidRows).toHaveLength(1)
    expect(preview.sites.invalidRows[0].errors[0]).toMatch(/not a valid date/)
  })

  it('validates local representative rows independently — no manufacturerKey needed, since the schema has no such relationship', async () => {
    const { service } = buildHarness()
    const preview = await service.preview(actor, {
      localRepresentativesCsv: 'name,contactEmail\nKenya Reg Partners,not-an-email\nUganda Reg Partners,valid@example.com',
    })

    expect(preview.localRepresentatives.validRows).toHaveLength(1)
    expect(preview.localRepresentatives.validRows[0].data.name).toBe('Uganda Reg Partners')
    expect(preview.localRepresentatives.invalidRows[0].errors[0]).toMatch(/not a valid email/)
  })

  it('flags an unrecognized country instead of silently dropping it', async () => {
    const { service, countryFindFirst } = buildHarness()
    countryFindFirst.mockResolvedValue(null)

    const preview = await service.preview(actor, {
      manufacturersCsv: 'manufacturerKey,name,country\nMFG-001,Acme Pharma,Narnia',
    })

    expect(preview.manufacturers.invalidRows).toHaveLength(1)
    expect(preview.manufacturers.invalidRows[0].errors[0]).toMatch(/Country "Narnia" is not recognized/)
  })

  it('accepts a real country by ISO code or name', async () => {
    const { service, countryFindFirst } = buildHarness()
    countryFindFirst.mockResolvedValue({ id: 'country-ke' })

    const preview = await service.preview(actor, {
      manufacturersCsv: 'manufacturerKey,name,country\nMFG-001,Acme Pharma,KE',
    })

    expect(preview.manufacturers.validRows).toHaveLength(1)
  })
})

describe('RegEntitiesImportService.commit', () => {
  it('creates manufacturers first, then resolves sites against the resulting key→id map, in one pass', async () => {
    const { service, createManufacturer, createManufacturingSite } = buildHarness()

    const result = await service.commit(
      actor,
      {
        manufacturers: [{ manufacturerKey: 'MFG-001', name: 'Acme Pharma' }],
        sites: [{ manufacturerKey: 'MFG-001', siteName: 'Nairobi Plant' }],
      },
      {},
    )

    expect(result.manufacturers.committed).toBe(1)
    expect(result.sites.committed).toBe(1)
    expect(createManufacturer).toHaveBeenCalledWith(actor, expect.objectContaining({ name: 'Acme Pharma' }), {})
    expect(createManufacturingSite).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ manufacturerId: 'mfg-Acme Pharma', siteName: 'Nairobi Plant' }),
      {},
    )
  })

  it('never creates a duplicate manufacturer when one with the same name already exists', async () => {
    const { service, findManufacturerByName, createManufacturer } = buildHarness()
    findManufacturerByName.mockResolvedValue({ id: 'existing-mfg', name: 'Acme Pharma' })

    const result = await service.commit(actor, { manufacturers: [{ manufacturerKey: 'MFG-001', name: 'Acme Pharma' }] }, {})

    expect(result.manufacturers.committed).toBe(1)
    expect(createManufacturer).not.toHaveBeenCalled()
  })

  it('reports a per-row failure without aborting the rest of the batch', async () => {
    const { service, createManufacturer } = buildHarness()
    createManufacturer
      .mockRejectedValueOnce(new Error('Something went wrong on row 1'))
      .mockImplementationOnce((_actor, dto) => Promise.resolve({ id: `mfg-${dto.name}`, ...dto }))

    const result = await service.commit(
      actor,
      {
        manufacturers: [
          { manufacturerKey: 'MFG-001', name: 'Broken Co' },
          { manufacturerKey: 'MFG-002', name: 'Working Co' },
        ],
      },
      {},
    )

    expect(result.manufacturers.committed).toBe(1)
    expect(result.manufacturers.failed).toEqual([{ rowNumber: 1, success: false, error: 'Something went wrong on row 1' }])
  })

  it('a site row referencing an unresolvable manufacturerKey fails only that row', async () => {
    const { service } = buildHarness()

    const result = await service.commit(
      actor,
      { sites: [{ manufacturerKey: 'Ghost Co', siteName: 'Some Site' }] },
      {},
    )

    expect(result.sites.committed).toBe(0)
    expect(result.sites.failed[0].error).toMatch(/does not match any manufacturer/)
  })

  it('imports local representatives independently of manufacturers/sites', async () => {
    const { service, createLocalRepresentative } = buildHarness()

    const result = await service.commit(
      actor,
      { localRepresentatives: [{ name: 'Kenya Reg Partners', contactEmail: 'ops@kenyareg.co.ke' }] },
      {},
    )

    expect(result.localRepresentatives.committed).toBe(1)
    expect(createLocalRepresentative).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ name: 'Kenya Reg Partners', contactEmail: 'ops@kenyareg.co.ke' }),
      {},
    )
  })

  it('writes one summary audit entry for the whole batch', async () => {
    const { service, auditLog } = buildHarness()

    await service.commit(actor, { manufacturers: [{ manufacturerKey: 'MFG-001', name: 'Acme Pharma' }] }, { ip: '1.2.3.4' })

    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reg_entities_bulk_import_completed',
        companyId: 'company-1',
        newValue: expect.objectContaining({ manufacturers: { attempted: 1, committed: 1, failed: 0 } }),
      }),
    )
  })
})
