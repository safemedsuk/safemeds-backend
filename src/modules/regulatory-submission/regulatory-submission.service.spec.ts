import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegulatorySubmissionService } from './regulatory-submission.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

const CASE_ROW = {
  id: 'case-1',
  referenceNumber: 'PV-2026-00042',
  channel: 'form',
  awarenessDate: new Date('2026-08-01'),
  receivedDate: new Date('2026-08-02'),
  additionalInformationEncrypted: null,
  reportTypeId: 'rt-adr',
  reportType: { id: 'rt-adr', typeKey: 'adr' },
  countryOfOccurrence: { id: 'country-ke', isoCode: 'KE', name: 'Kenya' },
  countryOfReport: { id: 'country-ke', isoCode: 'KE', name: 'Kenya' },
  reporter: { fullName: 'Jane Wanjiru', reporterType: 'consumer', qualification: null },
  patient: { initials: 'J.M.', ageYears: 34, sex: 'female', medicalHistoryEncrypted: null },
  suspectProducts: [],
  adverseEvents: [],
}

function buildHarness() {
  let workflowState: string | null = 'submission_ready'
  let submissionFormat: Record<string, unknown> | null = {
    channel: 'vigiflow',
    authorityId: 'auth-ppb',
    authority: { code: 'PPB', name: 'Pharmacy and Poisons Board' },
  }
  const regulatorySubmissionRows = new Map<string, Record<string, unknown>>()

  const mockTx = {
    workflowInstance: {
      findFirst: jest.fn(() =>
        Promise.resolve(workflowState ? { currentState: { stateKey: workflowState } } : null),
      ),
    },
    case: { findFirst: jest.fn(() => Promise.resolve(CASE_ROW)) },
    submissionFormat: { findFirst: jest.fn(() => Promise.resolve(submissionFormat)) },
    company: {
      findFirstOrThrow: jest.fn(() =>
        Promise.resolve({
          id: 'company-1',
          name: 'Demo Pharma',
          registeredAddress: null,
          regulatoryContactEmail: null,
          regulatoryContactPhone: null,
          homeCountry: { isoCode: 'KE', name: 'Kenya' },
        }),
      ),
    },
    regulatoryAuthority: {
      findFirstOrThrow: jest.fn(() =>
        Promise.resolve({ id: 'auth-ppb', code: 'PPB', name: 'Pharmacy and Poisons Board' }),
      ),
    },
    user: {
      findFirstOrThrow: jest.fn(() =>
        Promise.resolve({ id: 'user-1', fullName: 'Dr. Regulatory Officer' }),
      ),
    },
    regulatorySubmission: {
      count: jest.fn(({ where }: { where: { caseId: string } }) =>
        Promise.resolve(
          [...regulatorySubmissionRows.values()].filter((r) => r.caseId === where.caseId).length,
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          authority: { id: 'auth-ppb', code: 'PPB', name: 'Pharmacy and Poisons Board' },
          case: { id: 'case-1', referenceNumber: 'PV-2026-00042' },
        }
        regulatorySubmissionRows.set(data.id as string, row)
        return Promise.resolve(row)
      }),
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(regulatorySubmissionRows.get(where.id) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = regulatorySubmissionRows.get(where.id)!
          const updated = { ...existing, ...data }
          regulatorySubmissionRows.set(where.id, updated)
          return Promise.resolve(updated)
        },
      ),
    },
    documentVersion: { findFirst: jest.fn(() => Promise.resolve({ id: 'version-1' })) },
  }

  const rls = { runAsCompany: (_c: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const textEncryption = { decrypt: jest.fn((s: string) => s) } as never
  let uploadCounter = 0
  const uploadDirect = jest.fn().mockImplementation(() => {
    uploadCounter += 1
    return Promise.resolve({
      document: { id: `doc-${uploadCounter}` },
      version: { id: `version-${uploadCounter}` },
    })
  })
  const getDownloadUrl = jest.fn().mockResolvedValue({ url: 'https://r2.example.com/presigned' })
  const documentsService = { uploadDirect, getDownloadUrl } as never
  const reportabilityAssess = jest
    .fn()
    .mockResolvedValue({
      reportable: true,
      isForeign: false,
      reason: 'Local, confirmed rule.',
      authority: { id: 'auth-ppb' },
      deadline: { id: 'deadline-1' },
    })
  const reportabilityService = { assess: reportabilityAssess } as never
  const xmlBuild = jest.fn().mockReturnValue('<ichicsr></ichicsr>')
  const xmlBuilder = { build: xmlBuild } as never
  const pdfRender = jest.fn().mockResolvedValue(Buffer.from('%PDF-fake'))
  const pdfService = { render: pdfRender } as never
  const getObjectBuffer = jest.fn().mockResolvedValue(Buffer.from('fake-emblem-bytes'))
  const storageService = { getObjectBuffer } as never

  const service = new RegulatorySubmissionService(
    rls as never,
    auditService,
    textEncryption,
    documentsService,
    reportabilityService,
    xmlBuilder,
    pdfService,
    storageService,
  )

  return {
    service,
    auditLog,
    uploadDirect,
    getDownloadUrl,
    xmlBuild,
    pdfRender,
    getObjectBuffer,
    regulatorySubmissionRows,
    setWorkflowState: (s: string | null) => (workflowState = s),
    setSubmissionFormat: (f: Record<string, unknown> | null) => (submissionFormat = f),
  }
}

describe('RegulatorySubmissionService.generate()', () => {
  it('rejects when the case has not reached submission_ready', async () => {
    const { service, setWorkflowState } = buildHarness()
    setWorkflowState('quality_check')
    await expect(service.generate(actor, 'case-1', {})).rejects.toThrow(ConflictException)
  })

  it('rejects when no active submission format is configured for the report type', async () => {
    const { service, setSubmissionFormat } = buildHarness()
    setSubmissionFormat(null)
    await expect(service.generate(actor, 'case-1', {})).rejects.toThrow(ConflictException)
  })

  it('rejects a non-vigiflow channel (e.g. dhis2) — this action only generates E2B XML/PDF', async () => {
    const { service, setSubmissionFormat } = buildHarness()
    setSubmissionFormat({
      channel: 'dhis2',
      authorityId: 'auth-nvip',
      authority: { code: 'NVIP', name: 'NVIP' },
    })
    await expect(service.generate(actor, 'case-1', {})).rejects.toThrow(BadRequestException)
  })

  it('happy path: builds XML + PDF, uploads both, creates a submissionNumber=1 row, and audits', async () => {
    const { service, uploadDirect, xmlBuild, pdfRender, auditLog } = buildHarness()

    const result = await service.generate(actor, 'case-1', { ip: '1.2.3.4' })

    expect(xmlBuild).toHaveBeenCalledTimes(1)
    expect(pdfRender).toHaveBeenCalledTimes(1)
    expect(uploadDirect).toHaveBeenCalledTimes(2) // xml + pdf
    expect(result.submissionNumber).toBe(1)
    expect(result.xmlDocumentId).toBe('doc-1')
    expect(result.pdfDocumentId).toBe('doc-2')
    expect(result.reportable).toBe(true)
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'regulatory_submission_generated' }),
    )
  })

  it('increments submissionNumber for a second (resubmission) attempt on the same case', async () => {
    const { service, regulatorySubmissionRows } = buildHarness()
    await service.generate(actor, 'case-1', {})
    expect(regulatorySubmissionRows.size).toBe(1)

    const second = await service.generate(actor, 'case-1', {})
    expect(second.submissionNumber).toBe(2)
  })

  it('defaults to R2 when no format is given, and records it on the row', async () => {
    const { service, xmlBuild, regulatorySubmissionRows } = buildHarness()
    const result = await service.generate(actor, 'case-1', {})
    expect(xmlBuild).toHaveBeenCalledWith(expect.anything(), 'R2')
    expect(regulatorySubmissionRows.get(result.id)?.format).toBe('R2')
  })

  it('threads an explicit R3 choice through to the XML builder and the stored row (real-usage request, 22 Sep 2026, item 25)', async () => {
    const { service, xmlBuild, regulatorySubmissionRows } = buildHarness()
    const result = await service.generate(actor, 'case-1', {}, 'R3')
    expect(xmlBuild).toHaveBeenCalledWith(expect.anything(), 'R3')
    expect(regulatorySubmissionRows.get(result.id)?.format).toBe('R3')
  })

  it('names the generated XML file with the chosen format', async () => {
    const { service, uploadDirect } = buildHarness()
    await service.generate(actor, 'case-1', {}, 'R3')
    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ originalname: expect.stringContaining('E2B(R3)') }),
      expect.anything(),
      expect.anything(),
    )
  })
})

describe('RegulatorySubmissionService.attachEvidence()', () => {
  it('uploads the evidence file and records submittedAt/submittedBy on the submission row', async () => {
    const { service, regulatorySubmissionRows, auditLog } = buildHarness()
    const created = await service.generate(actor, 'case-1', {})

    const updated = await service.attachEvidence(
      actor,
      created.id,
      { buffer: Buffer.from('evidence'), originalname: 'confirmation.png', mimetype: 'image/png' },
      {},
    )

    expect(updated.evidenceDocumentId).toBeDefined()
    expect(updated.submittedAt).toBeInstanceOf(Date)
    expect(updated.submittedBy).toBe('user-1')
    expect(regulatorySubmissionRows.get(created.id)).toMatchObject({
      evidenceDocumentId: updated.evidenceDocumentId,
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'regulatory_submission_evidence_attached' }),
    )
  })

  it('404s for a submission that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.attachEvidence(
        actor,
        'missing',
        { buffer: Buffer.from('x'), originalname: 'f.png', mimetype: 'image/png' },
        {},
      ),
    ).rejects.toThrow(NotFoundException)
  })
})

describe('RegulatorySubmissionService.getDownloadUrl()', () => {
  it('rejects an invalid artifact value', async () => {
    const { service } = buildHarness()
    await expect(service.getDownloadUrl(actor, 'sub-1', 'foo' as never)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('404s when the requested artifact has not been attached yet (e.g. evidence before attachEvidence())', async () => {
    const { service } = buildHarness()
    const created = await service.generate(actor, 'case-1', {})
    await expect(service.getDownloadUrl(actor, created.id, 'evidence')).rejects.toThrow(
      NotFoundException,
    )
  })

  it('resolves a real presigned URL for an attached artifact', async () => {
    const { service, getDownloadUrl } = buildHarness()
    const created = await service.generate(actor, 'case-1', {})
    const result = await service.getDownloadUrl(actor, created.id, 'xml')
    expect(result.url).toBe('https://r2.example.com/presigned')
    expect(getDownloadUrl).toHaveBeenCalledWith(actor, 'doc-1', 'version-1')
  })
})
