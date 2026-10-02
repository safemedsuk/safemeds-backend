import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { SignalReportData, SignalReportPdfService } from './signal-report-pdf.service'

function fixture(overrides: Partial<SignalReportData> = {}): SignalReportData {
  return {
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
    linkedCases: [
      { referenceNumber: 'KEN-2026-KEN-00001', status: 'submitted' },
      { referenceNumber: 'KEN-2026-KEN-00002', status: 'triage' },
    ],
    companyName: 'Demo Pharma',
    generatedByUserFullName: 'Dr. QPPV',
    generatedAt: new Date('2026-09-22T10:00:00Z'),
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  }
}

/** Real render + `pdftotext` readback — pdfkit compresses its content streams by default, so a raw byte-level `Buffer.includes()` check on rendered text is a false signal; this codebase's own established discipline (see CLAUDE.md's pdfkit gotchas) is to actually extract and read the text back. */
function renderToText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'signal-report-pdf-test-'))
  const pdfPath = join(dir, 'report.pdf')
  writeFileSync(pdfPath, pdf)
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' })
}

describe('SignalReportPdfService', () => {
  const service = new SignalReportPdfService()

  it('produces a real, non-empty PDF (magic bytes present)', async () => {
    const pdf = await service.render(fixture())
    expect(pdf.length).toBeGreaterThan(500)
    expect(pdf.slice(0, 5).toString('utf8')).toBe('%PDF-')
  })

  it('embeds the real signal content, not placeholder text', async () => {
    const pdf = await service.render(fixture())
    const text = renderToText(pdf)
    expect(text).toContain('Amoxil')
    expect(text).toContain('KEN-2026-KEN-00001')
    expect(text).toContain('Demo Pharma')
    expect(text).toContain('Update the SmPC hepatic warning section')
  })

  it('renders "Not recorded" for a field the signal has not reached yet, never a blank/undefined leak', async () => {
    const pdf = await service.render(
      fixture({ assessmentNote: null, recommendationAction: null, recommendationNote: null }),
    )
    const text = renderToText(pdf)
    expect(text).toContain('Not recorded')
  })

  it('renders "No cases linked" when nothing has been linked yet', async () => {
    const pdf = await service.render(fixture({ linkedCases: [] }))
    const text = renderToText(pdf)
    expect(text).toContain('No cases linked')
  })
})
