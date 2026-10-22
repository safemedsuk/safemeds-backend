import { ConflictException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import {
  currentWasteCaseStep,
  deriveWasteCaseSteps,
  wasteCaseClosureBlockers,
  WasteCaseStepFields,
  WasteCaseSteps,
  WasteDisposalCaseService,
} from './waste-disposal-case.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
  platformRole: null,
  tokenVersion: 1,
}

const emptyFields: WasteCaseStepFields = {
  applicationReference: null,
  feeAmountKes: null,
  applicationSubmittedAt: null,
  invoiceDocumentId: null,
  paymentReceiptDocumentId: null,
  disposalCompanyName: null,
  handoverCertificateDocumentId: null,
  ppbVerifiedAt: null,
  destructionDate: null,
  destructionLocation: null,
  destructionPdfDocumentId: null,
  ppbCertificateDocumentId: null,
}

const completeFields: WasteCaseStepFields = {
  applicationReference: 'PPB/APP/123',
  feeAmountKes: 2500,
  applicationSubmittedAt: new Date('2026-10-01'),
  invoiceDocumentId: 'inv',
  paymentReceiptDocumentId: 'rcpt',
  disposalCompanyName: 'Green Burn Ltd',
  handoverCertificateDocumentId: 'cert',
  ppbVerifiedAt: new Date('2026-10-02'),
  destructionDate: new Date('2026-10-03'),
  destructionLocation: 'Dandora site',
  destructionPdfDocumentId: 'pdf',
  ppbCertificateDocumentId: 'ppb',
}

const fullAttendees = [
  { attendeeRole: 'client_representative', withdrawnAt: null },
  { attendeeRole: 'ppb_officer', withdrawnAt: null },
]

describe('deriveWasteCaseSteps (pure)', () => {
  it('derives nothing complete from an empty case', () => {
    const steps = deriveWasteCaseSteps(emptyFields, [])
    expect(Object.values(steps).every((v) => v === false)).toBe(true)
    expect(currentWasteCaseStep(steps)).toBe(2)
  })

  it('marks destruction incomplete without a client representative AND a PPB officer', () => {
    const onlyClient = deriveWasteCaseSteps(completeFields, [
      { attendeeRole: 'client_representative', withdrawnAt: null },
    ])
    expect(onlyClient.destruction).toBe(false)
    const withdrawn = deriveWasteCaseSteps(completeFields, [
      { attendeeRole: 'client_representative', withdrawnAt: null },
      { attendeeRole: 'ppb_officer', withdrawnAt: new Date() },
    ])
    expect(withdrawn.destruction).toBe(false)
  })

  it('a handover is not complete until PPB has verified the certificate', () => {
    const unverified = deriveWasteCaseSteps(
      { ...completeFields, ppbVerifiedAt: null },
      fullAttendees,
    )
    expect(unverified.handover).toBe(false)
  })

  it('reports step 7 (closure) once every step is complete', () => {
    const steps = deriveWasteCaseSteps(completeFields, fullAttendees)
    expect(currentWasteCaseStep(steps)).toBe(7)
    expect(wasteCaseClosureBlockers(steps)).toEqual([])
  })
})

describe('wasteCaseClosureBlockers', () => {
  it('names every incomplete step in plain language', () => {
    const steps: WasteCaseSteps = {
      application: true,
      evidence: false,
      handover: true,
      destruction: false,
      ppbCertificate: false,
    }
    const blockers = wasteCaseClosureBlockers(steps)
    expect(blockers).toHaveLength(3)
    expect(blockers[0]).toMatch(/Step 3/)
    expect(blockers[1]).toMatch(/Step 5/)
    expect(blockers[2]).toMatch(/Step 6/)
  })
})

interface CaseRow extends WasteCaseStepFields {
  id: string
  companyId: string
  status: string
  caseNumber: string
  weighedAt: Date
  attendees: Array<{ id: string; attendeeRole: string; withdrawnAt: Date | null; name: string }>
  photos: unknown[]
  items: unknown[]
  [key: string]: unknown
}

function buildHarness(row: Partial<CaseRow> = {}) {
  const caseRow: CaseRow = {
    id: 'case-1',
    companyId: 'company-1',
    status: 'open',
    caseNumber: 'ACME-WDC-2026-0001',
    weighedAt: new Date('2026-09-01'),
    attendees: [],
    photos: [],
    items: [],
    ...emptyFields,
    ...row,
  }
  const tx = {
    wasteDisposalCase: {
      findFirst: jest.fn(() => Promise.resolve({ ...caseRow })),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(caseRow, data)
        return Promise.resolve({ ...caseRow })
      }),
    },
    wasteDisposalCaseAttendee: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        caseRow.attendees.push({
          id: data.id as string,
          attendeeRole: data.attendeeRole as string,
          withdrawnAt: null,
          name: data.name as string,
        })
        return Promise.resolve(data)
      }),
    },
    wasteDisposalCasePhoto: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        caseRow.photos.push(data)
        return Promise.resolve(data)
      }),
    },
    company: { findUnique: jest.fn(() => Promise.resolve({ name: 'ACME' })) },
  }
  const rls = {
    runAsCompany: (_c: string, fn: (t: typeof tx) => unknown) => fn(tx),
  }
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const documents = {
    uploadDirect: jest
      .fn()
      .mockResolvedValue({ document: { id: 'doc-new', title: 't' }, version: {} }),
  }
  const storage = { getObjectBuffer: jest.fn() }
  const numbering = { allocate: jest.fn().mockResolvedValue('ACME-WDC-2026-0001') } as never
  const pdf = {
    isSupportedMimeType: jest.fn((m: string) => m === 'image/jpeg' || m === 'image/png'),
    buildPhotoPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  }
  const service = new WasteDisposalCaseService(
    rls as never,
    audit as never,
    documents as never,
    storage as never,
    numbering,
    pdf,
  )
  return { service, caseRow, audit, documents, pdf, tx }
}

const file = { buffer: Buffer.from('x'), originalname: 'invoice.pdf', mimetype: 'application/pdf' }

describe('WasteDisposalCaseService — step order and evidence gates', () => {
  it('refuses to attach an invoice before the PPB application is recorded (step 3 needs step 2)', async () => {
    const { service, documents } = buildHarness()
    await expect(
      service.attachEvidence(actor, 'case-1', 'invoice', file, {}),
    ).rejects.toMatchObject({
      response: { code: 'STEP_OUT_OF_ORDER' },
    })
    expect(documents.uploadDirect).not.toHaveBeenCalled()
  })

  it('refuses to verify a disposal company that has no certificate attached', async () => {
    const { service } = buildHarness({
      applicationReference: 'A',
      feeAmountKes: 2500,
      applicationSubmittedAt: new Date(),
      invoiceDocumentId: 'i',
      paymentReceiptDocumentId: 'r',
      disposalCompanyName: 'Green Burn Ltd',
    })
    await expect(service.verifyHandover(actor, 'case-1', {})).rejects.toMatchObject({
      response: { code: 'HANDOVER_INCOMPLETE' },
    })
  })

  it('refuses destruction details before the disposal company is verified (step 5 needs step 4)', async () => {
    const { service } = buildHarness({
      applicationReference: 'A',
      feeAmountKes: 2500,
      applicationSubmittedAt: new Date(),
      invoiceDocumentId: 'i',
      paymentReceiptDocumentId: 'r',
    })
    await expect(
      service.recordDestruction(
        actor,
        'case-1',
        { destructionDate: '2026-10-03', destructionLocation: 'Dandora' },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'STEP_OUT_OF_ORDER' } })
  })

  it('refuses to change an earlier step once a later one is complete (no silent rewrite of evidence)', async () => {
    const { service } = buildHarness({ ...completeFields, attendees: [] })
    await expect(
      service.recordApplication(
        actor,
        'case-1',
        {
          applicationReference: 'NEW',
          invoiceReference: 'X',
          feeAmountKes: 2500,
          applicationSubmittedAt: '2026-10-01',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses any edit to a closed case', async () => {
    const { service } = buildHarness({ status: 'closed' })
    await expect(
      service.recordDestruction(
        actor,
        'case-1',
        { destructionDate: '2026-10-03', destructionLocation: 'Dandora' },
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'CASE_CLOSED' } })
  })
})

describe('WasteDisposalCaseService — closure (step 7)', () => {
  it('refuses closure and lists every blocker when evidence is missing', async () => {
    const { service } = buildHarness({ applicationReference: 'A' })
    await expect(service.close(actor, 'case-1', {})).rejects.toMatchObject({
      response: { code: 'CLOSURE_BLOCKED' },
    })
  })

  it('closes a fully evidenced case and audits the status change', async () => {
    const attendees = [
      { id: 'a1', attendeeRole: 'client_representative', withdrawnAt: null, name: 'Jane' },
      { id: 'a2', attendeeRole: 'ppb_officer', withdrawnAt: null, name: 'Officer' },
    ]
    const { service, caseRow, audit } = buildHarness({ ...completeFields, attendees })
    await service.close(actor, 'case-1', {})
    expect(caseRow.status).toBe('closed')
    expect(caseRow.closedByUserId).toBe('user-1')
    expect(audit.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'waste_disposal_case_closed' }),
    )
  })
})

describe('WasteDisposalCaseService — destruction photos (step 5)', () => {
  it('rejects a non-JPEG/PNG photo before anything is uploaded', async () => {
    const { service, documents } = buildHarness({
      ...completeFields,
      destructionDate: null,
      destructionPdfDocumentId: null,
      disposalCompanyName: 'Green Burn Ltd',
      handoverCertificateDocumentId: 'cert',
      ppbVerifiedAt: new Date(),
    })
    await expect(
      service.addDestructionPhotos(
        actor,
        'case-1',
        [{ buffer: Buffer.from('x'), originalname: 'scan.tiff', mimetype: 'image/tiff' }],
        {},
      ),
    ).rejects.toMatchObject({ response: { code: 'UNSUPPORTED_PHOTO_TYPE' } })
    expect(documents.uploadDirect).not.toHaveBeenCalled()
  })

  it('keeps each original photo and writes ONE combined PDF as the destruction document', async () => {
    const { service, documents, pdf, caseRow } = buildHarness({
      applicationReference: 'A',
      feeAmountKes: 2500,
      applicationSubmittedAt: new Date(),
      invoiceDocumentId: 'i',
      paymentReceiptDocumentId: 'r',
      disposalCompanyName: 'Green Burn Ltd',
      handoverCertificateDocumentId: 'cert',
      ppbVerifiedAt: new Date(),
      destructionDate: new Date('2026-10-03'),
      destructionLocation: 'Dandora',
    })
    const photos = [
      { buffer: Buffer.from('a'), originalname: 'one.jpg', mimetype: 'image/jpeg' },
      { buffer: Buffer.from('b'), originalname: 'two.png', mimetype: 'image/png' },
    ]
    await service.addDestructionPhotos(actor, 'case-1', photos, {})
    // two originals + one combined PDF
    expect(documents.uploadDirect).toHaveBeenCalledTimes(3)
    expect(pdf.buildPhotoPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: expect.arrayContaining([expect.objectContaining({ filename: 'one.jpg' })]),
      }),
    )
    expect(caseRow.destructionPdfDocumentId).toBe('doc-new')
  })
})
