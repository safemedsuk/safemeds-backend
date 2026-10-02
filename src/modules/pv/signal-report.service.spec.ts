import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SignalReportService } from './signal-report.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}

const SIGNAL_ROW = {
  id: 'signal-1',
  companyId: 'company-1',
  title: 'Unexpected hepatotoxicity with Amoxil',
  description: 'Cluster of liver injury reports across 3 cases',
  detectionMethod: 'pattern_flag',
  productIdentifier: 'Amoxil',
  batchNumber: 'B-2026-001',
  status: 'assessed',
  previousAwareness: false,
  previousAwarenessNote: null,
  strengthOfEvidenceCaseCount: 3,
  clinicalRelevanceNote: 'Clinically significant',
  severityNote: 'One hospitalisation',
  patientExposureNote: null,
  expectedRegulatoryResponseNote: null,
  assessmentNote: 'Consistent with a genuine signal',
  recommendationAction: 'propose_product_info_update',
  recommendationNote: 'Update the SmPC hepatic warning section',
  createdAt: new Date('2026-08-01'),
}

function buildHarness() {
  const generatedReportRows = new Map<string, Record<string, unknown>>()

  const mockTx = {
    signal: { findFirst: jest.fn(() => Promise.resolve(SIGNAL_ROW)) },
    company: { findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: 'company-1', name: 'Demo Pharma' })) },
    user: { findFirstOrThrow: jest.fn(() => Promise.resolve({ id: 'user-1', fullName: 'Dr. QPPV' })) },
    signalCase: {
      findMany: jest.fn(() =>
        Promise.resolve([
          { case: { referenceNumber: 'KEN-2026-KEN-00001', status: 'submitted' } },
          { case: { referenceNumber: 'KEN-2026-KEN-00002', status: 'triage' } },
        ]),
      ),
    },
    generatedReport: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        generatedReportRows.set(data.id as string, data)
        return Promise.resolve(data)
      }),
    },
  }

  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof mockTx) => unknown) => fn(mockTx) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'version-1' } })
  const documentsService = { uploadDirect } as never
  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-fake'))
  const pdfService = { render } as never

  const service = new SignalReportService(rls as never, auditService, documentsService, pdfService)
  return { service, mockTx, auditLog, uploadDirect, render, generatedReportRows }
}

describe('SignalReportService.generate() (real-usage request, 22 Sep 2026, item 22)', () => {
  it('renders the PDF from the real signal detail, uploads it, and creates a final GeneratedReport row', async () => {
    const { service, render, uploadDirect, generatedReportRows, auditLog } = buildHarness()

    const result = await service.generate(actor, 'signal-1', { ip: '1.2.3.4' })

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Unexpected hepatotoxicity with Amoxil',
        linkedCases: [
          { referenceNumber: 'KEN-2026-KEN-00001', status: 'submitted' },
          { referenceNumber: 'KEN-2026-KEN-00002', status: 'triage' },
        ],
        companyName: 'Demo Pharma',
        generatedByUserFullName: 'Dr. QPPV',
      }),
    )
    expect(uploadDirect).toHaveBeenCalledWith(
      actor,
      'generated_report',
      result.id,
      expect.objectContaining({ mimetype: 'application/pdf' }),
      { title: 'Signal Report' },
      { ip: '1.2.3.4' },
    )
    expect(generatedReportRows.get(result.id)).toMatchObject({
      moduleKey: 'pv',
      reportTypeKey: 'signal_report',
      recordType: 'signal',
      recordId: 'signal-1',
      status: 'final',
    })
    expect(auditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'signal_report_generated', recordId: 'signal-1' }),
    )
  })

  it('404s for a signal that does not exist', async () => {
    const { service, mockTx } = buildHarness()
    mockTx.signal.findFirst = jest.fn(() => Promise.resolve(null)) as never

    await expect(service.generate(actor, 'nope', {})).rejects.toThrow(NotFoundException)
  })
})
