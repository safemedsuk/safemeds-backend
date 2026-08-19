import { NotFoundException } from '@nestjs/common'

import { SubmitPublicReportDto } from './dto/submit-public-report.dto'
import { PublicReportingService } from './public-reporting.service'

function buildHarness() {
  const companies = new Map([
    [
      'company-1',
      {
        id: 'company-1',
        name: 'FankamMeds Inc',
        publicReportingSlug: 'fankammeds-inc',
        status: 'active',
        homeCountryId: 'country-ke',
      },
    ],
    [
      'company-2',
      {
        id: 'company-2',
        name: 'Suspended Co',
        publicReportingSlug: 'suspended-co',
        status: 'suspended',
        homeCountryId: 'country-ke',
      },
    ],
  ])
  const reportTypes = [
    { id: 'report-type-adr', typeKey: 'adr', moduleKey: 'pv', name: 'Adverse Drug Reaction' },
  ]
  const products = [
    {
      id: 'product-1',
      companyId: 'company-1',
      brandName: 'Amoxil',
      genericName: 'Amoxicillin',
      innName: 'Amoxicillin',
      atcCode: 'J01CA04',
      dosageForm: 'Tablet',
      strength: '500mg',
      isActive: true,
    },
    {
      id: 'product-2',
      companyId: 'company-1',
      brandName: 'Panadol',
      genericName: 'Paracetamol',
      innName: null,
      atcCode: 'N02BE01',
      dosageForm: 'Tablet',
      strength: '500mg',
      isActive: true,
    },
    {
      id: 'product-3',
      companyId: 'company-1',
      brandName: 'Withdrawn Item',
      genericName: 'Discontinued',
      innName: null,
      atcCode: null,
      dosageForm: 'Tablet',
      strength: '10mg',
      isActive: false,
    },
  ]

  const cases = new Map([
    ['case-1', { id: 'case-1', companyId: 'company-1', referenceNumber: 'PV-2026-00001' }],
  ])

  const tables = {
    company: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { publicReportingSlug: string; status: string } }) =>
            Promise.resolve(
              [...companies.values()].find(
                (c) =>
                  c.publicReportingSlug === where.publicReportingSlug && c.status === where.status,
              ) ?? null,
            ),
        ),
    },
    case: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { companyId: string; referenceNumber: string } }) =>
            Promise.resolve(
              [...cases.values()].find(
                (c) =>
                  c.companyId === where.companyId && c.referenceNumber === where.referenceNumber,
              ) ?? null,
            ),
        ),
    },
    reportType: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { typeKey?: string; moduleKey: string } }) =>
          Promise.resolve(
            reportTypes.find(
              (rt) =>
                (where.typeKey ? rt.typeKey === where.typeKey : true) &&
                rt.moduleKey === where.moduleKey,
            ) ?? null,
          ),
        ),
    },
    product: {
      findMany: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: {
              companyId: string
              isActive: boolean
              OR: Array<{ brandName?: { contains: string } }>
            }
          }) => {
            const q = where.OR[0].brandName!.contains.toLowerCase()
            return Promise.resolve(
              products.filter(
                (p) =>
                  p.companyId === where.companyId &&
                  p.isActive === where.isActive &&
                  (p.brandName.toLowerCase().includes(q) ||
                    p.genericName.toLowerCase().includes(q) ||
                    (p.innName ?? '').toLowerCase().includes(q) ||
                    (p.atcCode ?? '').toLowerCase().includes(q)),
              ),
            )
          },
        ),
    },
  }
  const rls = { runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables) }

  const createFromSystemChannel = jest
    .fn()
    .mockResolvedValue({ id: 'case-1', referenceNumber: 'PV-2026-00001' })
  const pvCaseService = { createFromSystemChannel } as never

  const sendCaseReceivedConfirmation = jest.fn().mockResolvedValue(undefined)
  const mailService = { sendCaseReceivedConfirmation } as never

  const uploadDirectSystem = jest
    .fn()
    .mockResolvedValue({ document: { id: 'document-1' }, version: { id: 'version-1' } })
  const documentsService = { uploadDirectSystem } as never

  const linkSystem = jest.fn().mockResolvedValue({ id: 'source-document-1' })
  const sourceDocumentService = { linkSystem } as never

  const service = new PublicReportingService(
    rls as never,
    pvCaseService,
    mailService,
    documentsService,
    sourceDocumentService,
  )
  return {
    service,
    createFromSystemChannel,
    sendCaseReceivedConfirmation,
    uploadDirectSystem,
    linkSystem,
  }
}

const baseSubmission: SubmitPublicReportDto = {
  reporter: { reporterType: 'consumer', fullName: 'A Patient' },
  patient: { ageYears: 40, sex: 'female' },
  suspectProducts: [{ drugCharacterization: 'suspect', medicinalProduct: 'Panadol' }],
  adverseEvents: [{ reportedTerm: 'Rash', narrative: 'Developed a rash' }],
}

describe('PublicReportingService', () => {
  describe('resolveCompanyDisplay()', () => {
    it('returns the company name and the resolved default report type name for a real, active slug', async () => {
      const { service } = buildHarness()
      const result = await service.resolveCompanyDisplay('fankammeds-inc')
      expect(result).toEqual({
        companyName: 'FankamMeds Inc',
        reportTypeName: 'Adverse Drug Reaction',
      })
    })

    it('404s for an unknown slug', async () => {
      const { service } = buildHarness()
      await expect(service.resolveCompanyDisplay('not-a-real-slug')).rejects.toThrow(
        NotFoundException,
      )
    })

    it("404s for a suspended company's slug — never leaks that the company exists", async () => {
      const { service } = buildHarness()
      await expect(service.resolveCompanyDisplay('suspended-co')).rejects.toThrow(NotFoundException)
    })
  })

  describe('submit()', () => {
    it('resolves the company, defaults report type/countries/dates, and delegates to createFromSystemChannel', async () => {
      const { service, createFromSystemChannel } = buildHarness()

      const result = await service.submit('fankammeds-inc', baseSubmission, { ip: '5.5.5.5' })

      expect(result).toEqual({ referenceNumber: 'PV-2026-00001' })
      expect(createFromSystemChannel).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({
          reportTypeId: 'report-type-adr',
          countryOfOccurrenceId: 'country-ke',
          countryOfReportId: 'country-ke',
          reporter: baseSubmission.reporter,
          suspectProducts: baseSubmission.suspectProducts,
          adverseEvents: baseSubmission.adverseEvents,
        }),
        'public_url',
        null,
        { ip: '5.5.5.5' },
      )
    })

    it('defaults awarenessDate/receivedDate to today, in ISO date form', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.submit('fankammeds-inc', baseSubmission, {})

      const [, dto] = createFromSystemChannel.mock.calls[0]
      const today = new Date().toISOString().slice(0, 10)
      expect(dto.awarenessDate).toBe(today)
      expect(dto.receivedDate).toBe(today)
    })

    it('404s for an unknown slug rather than silently creating a case for nobody', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await expect(service.submit('not-a-real-slug', baseSubmission, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(createFromSystemChannel).not.toHaveBeenCalled()
    })

    it('sends the reporter a real receipt confirmation when they gave an email address — Stage 3.3', async () => {
      const { service, sendCaseReceivedConfirmation } = buildHarness()
      await service.submit(
        'fankammeds-inc',
        {
          ...baseSubmission,
          reporter: { ...baseSubmission.reporter, email: 'a.patient@example.com' },
        },
        {},
      )
      expect(sendCaseReceivedConfirmation).toHaveBeenCalledWith(
        'a.patient@example.com',
        'FankamMeds Inc',
        'PV-2026-00001',
      )
    })

    it('sends no confirmation email when the reporter gave no email address', async () => {
      const { service, sendCaseReceivedConfirmation } = buildHarness()
      await service.submit('fankammeds-inc', baseSubmission, {})
      expect(sendCaseReceivedConfirmation).not.toHaveBeenCalled()
    })

    it('passes through the special-situation fields (falsified/substandard, pregnancy)', async () => {
      const { service, createFromSystemChannel } = buildHarness()
      await service.submit(
        'fankammeds-inc',
        {
          ...baseSubmission,
          suspectedFalsifiedOrSubstandard: true,
          pregnancy: { outcome: 'ongoing' },
        },
        {},
      )

      const [, dto] = createFromSystemChannel.mock.calls[0]
      expect(dto.suspectedFalsifiedOrSubstandard).toBe(true)
      expect(dto.pregnancy).toEqual({ outcome: 'ongoing' })
    })
  })

  describe('attachSourceDocument() — Stage 3.4', () => {
    const file = {
      buffer: Buffer.from('fake image bytes'),
      originalname: 'packaging.jpg',
      mimetype: 'image/jpeg',
    }

    it('uploads and links a source document against the case matching the given reference number', async () => {
      const { service, uploadDirectSystem, linkSystem } = buildHarness()

      const result = await service.attachSourceDocument('fankammeds-inc', 'PV-2026-00001', file, {})

      expect(result).toEqual({ attached: true })
      expect(uploadDirectSystem).toHaveBeenCalledWith(
        'company-1',
        'pv_case',
        'case-1',
        file,
        { title: 'Source document (public report)' },
        {},
      )
      expect(linkSystem).toHaveBeenCalledWith('company-1', 'case-1', 'document-1', {})
    })

    it('404s for an unknown slug', async () => {
      const { service } = buildHarness()
      await expect(
        service.attachSourceDocument('not-a-real-slug', 'PV-2026-00001', file, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s for a reference number that does not belong to the resolved company', async () => {
      const { service, uploadDirectSystem } = buildHarness()
      await expect(
        service.attachSourceDocument('fankammeds-inc', 'PV-2026-99999', file, {}),
      ).rejects.toThrow(NotFoundException)
      expect(uploadDirectSystem).not.toHaveBeenCalled()
    })
  })

  describe('searchProducts() — Stage 3.2', () => {
    it('returns a public-safe projection of matching, active products for the resolved company', async () => {
      const { service } = buildHarness()
      const results = await service.searchProducts('fankammeds-inc', 'amox')
      expect(results).toEqual([
        {
          id: 'product-1',
          brandName: 'Amoxil',
          genericName: 'Amoxicillin',
          innName: 'Amoxicillin',
          atcCode: 'J01CA04',
          dosageForm: 'Tablet',
          strength: '500mg',
        },
      ])
    })

    it('never returns a deactivated product', async () => {
      const { service } = buildHarness()
      const results = await service.searchProducts('fankammeds-inc', 'discontinued')
      expect(results).toEqual([])
    })

    it('returns an empty array for a query shorter than 2 characters, without querying the database', async () => {
      const { service } = buildHarness()
      const results = await service.searchProducts('fankammeds-inc', 'a')
      expect(results).toEqual([])
    })

    it('404s for an unknown slug rather than leaking whether any company matches', async () => {
      const { service } = buildHarness()
      await expect(service.searchProducts('not-a-real-slug', 'amox')).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
