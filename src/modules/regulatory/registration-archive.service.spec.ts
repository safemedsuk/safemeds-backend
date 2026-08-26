import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegistrationArchiveService } from './registration-archive.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const registrationFindFirst = jest.fn().mockResolvedValue({
    id: 'reg-1',
    companyId: 'company-1',
    registrationNumber: 'PPB-2026-0001',
    product: { brandName: 'Amoxiclav' },
    authority: { name: 'Pharmacy and Poisons Board' },
  })

  const dossierFindMany = jest.fn().mockResolvedValue([
    {
      id: 'dossier-1',
      companyId: 'company-1',
      productRegistrationId: 'reg-1',
      status: 'approved',
      createdAt: new Date('2026-01-01'),
      regSubmissions: [
        {
          id: 'sub-1',
          submissionNumber: 1,
          channel: 'paper_pdf',
          generatedAt: new Date('2026-02-01'),
          dispatchedAt: new Date('2026-02-02'),
        },
      ],
      regQueries: [
        {
          id: 'q-1',
          receivedDate: new Date('2026-02-10'),
          status: 'closed',
          queryTextEncrypted: 'enc(Please clarify.)',
        },
      ],
      regVariation: null,
    },
  ])

  const obligationFindMany = jest
    .fn()
    .mockResolvedValue([
      {
        id: 'obligation-1',
        companyId: 'company-1',
        obligationType: 'annual_report',
        dueAt: new Date('2027-01-01'),
        status: 'pending',
        _count: { fulfillments: 2 },
      },
    ])

  const feeInvoiceFindMany = jest
    .fn()
    .mockResolvedValue([
      {
        id: 'invoice-1',
        feeType: 'application',
        amount: '5000.00',
        currency: 'KES',
        dueAt: new Date('2026-04-01'),
        status: 'paid',
      },
    ])

  const tables = {
    productRegistration: { findFirst: registrationFindFirst },
    regDossier: { findMany: dossierFindMany },
    regPostMarketObligation: { findMany: obligationFindMany },
    regFeeInvoice: { findMany: feeInvoiceFindMany },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const decrypt = jest
    .fn()
    .mockImplementation((v: string) => v.replace(/^enc\(/, '').replace(/\)$/, ''))
  const encryptionService = { decrypt }

  const service = new RegistrationArchiveService(rls as never, encryptionService as never)
  return {
    service,
    registrationFindFirst,
    dossierFindMany,
    obligationFindMany,
    feeInvoiceFindMany,
    decrypt,
  }
}

describe('RegistrationArchiveService.getArchive', () => {
  it('aggregates dossiers (with real decrypted query text), obligations, and fee invoices for a registration', async () => {
    const { service, decrypt } = buildHarness()

    const archive = await service.getArchive(actor, 'reg-1')

    expect(archive.registration.productBrandName).toBe('Amoxiclav')
    expect(archive.dossiers).toHaveLength(1)
    expect(archive.dossiers[0].submissions).toHaveLength(1)
    expect(archive.dossiers[0].queries[0].queryText).toBe('Please clarify.')
    expect(decrypt).toHaveBeenCalledWith('enc(Please clarify.)')
    expect(archive.obligations[0].fulfillmentCount).toBe(2)
    expect(archive.feeInvoices).toHaveLength(1)
  })

  it('404s when the registration does not resolve (cross-tenant, invisible under RLS)', async () => {
    const { service, registrationFindFirst } = buildHarness()
    registrationFindFirst.mockResolvedValue(null)

    await expect(service.getArchive(actor, 'other-co-reg')).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    })
  })
})

describe('RegistrationArchiveService.exportCsv', () => {
  it('produces a real CSV with one row per dossier/submission/query/obligation/fee', async () => {
    const { service } = buildHarness()

    const csv = await service.exportCsv(actor, 'reg-1')
    const lines = csv.split('\n')

    expect(lines[0]).toBe('Type,Date,Reference,Detail,Status')
    expect(lines.some((l) => l.startsWith('Dossier,2026-01-01'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Submission,2026-02-01,#1'))).toBe(true)
    expect(lines.some((l) => l.includes('Please clarify.'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Obligation,2027-01-01,annual_report'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Fee,2026-04-01,application'))).toBe(true)
  })
})
