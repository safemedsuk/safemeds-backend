import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 50
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2

const COLOR_BAR = '#0C5446'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#0A1E24'
const COLOR_MUTED = '#5B7079'
const COLOR_BORDER = '#D1D5DB'
const COLOR_ROW_ALT = '#F3F4F6'

/**
 * Real-usage content, 11 Sep 2026 — the literal structure of
 * `vigicloud document formats/kenya-psmf-template.docx`, transcribed
 * section by section, not paraphrased. Every field here is optional
 * (`?`) because a company can generate a real, honest PSMF PDF at any
 * point in filling this out — an incomplete section renders as a
 * "Not yet provided" placeholder line (never a fabricated value),
 * matching this project's own "never guess, show the real gap" rule.
 */
export interface PsmfContent {
  reference?: {
    psmfReferenceNumber?: string
    mainLocationOfPvActivities?: string
  }
  qppv?: {
    primary?: {
      fullName?: string
      professionalQualification?: string
      professionalBoardRegistrationNo?: string
      physicalWorkAddress?: string
      emergencyMobileNumber?: string
      officialEmail?: string
    }
    backup?: {
      fullName?: string
      contactEmail?: string
      contactPhone?: string
    }
  }
  organizationalStructure?: {
    corporateGovernanceNarrative?: string
    ltrRegisteredName?: string
    ltrPremiseLicenseNumber?: string
    ltrScopeOfOperations?: string
  }
  sourcesOfSafetyData?: string[]
  computerizedSystems?: {
    localTrackingTool?: string
    globalSafetyDatabase?: string
    submissionPortal?: string
    dataBackupProtocol?: string
  }
  sops?: { reference?: string; title?: string; version?: string }[]
  qms?: {
    trainingCadence?: string
    internalAuditCadence?: string
    capaReviewCadence?: string
  }
  appendices?: string[]
}

export interface PsmfPdfData {
  companyName: string
  version: number
  status: string
  createdAt: Date
  content: PsmfContent
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }
}

/**
 * Every helper below pins an explicit `x`/`y` on every single `.text()`
 * call and explicitly sets `doc.y` (and resets `doc.x` to the margin)
 * afterward — never relying on pdfkit's own ambient flow cursor, even
 * across calls that look sequential. This is the same fix class as the
 * `periodic-report-pdf.service.ts` `fullWidthText()`/`ensureSpace()`
 * bug (see CLAUDE.md's own gotchas entry): a `{ continued: true }`
 * chain's own trailing cursor state can silently leak into the *next*,
 * unrelated `.text()` call with no explicit position, so two blocks end
 * up rendering on top of each other. Caught here by generating a real
 * PDF and reading it back with `pdftotext` during this feature's own
 * browser verification, not assumed correct from the code alone.
 */

function sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 30)
  const y = doc.y
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 22).fill(COLOR_BAR)
  doc
    .fillColor(COLOR_BAR_TEXT)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(title, PAGE_MARGIN + 8, y + 5, { lineBreak: false })
  doc.x = PAGE_MARGIN
  doc.y = y + 22 + 10
  doc.fillColor(COLOR_TEXT).font('Helvetica')
}

const FIELD_LABEL_WIDTH = 190

function field(doc: PDFKit.PDFDocument, label: string, value: string | undefined): void {
  ensureSpace(doc, 16)
  const y = doc.y
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor(COLOR_MUTED)
    .text(label, PAGE_MARGIN, y, { width: FIELD_LABEL_WIDTH, lineBreak: false })
  const hasValue = Boolean(value?.trim())
  doc
    .font('Helvetica')
    .fillColor(hasValue ? COLOR_TEXT : COLOR_MUTED)
    .text(hasValue ? value!.trim() : 'Not yet provided', PAGE_MARGIN + FIELD_LABEL_WIDTH, y, {
      width: CONTENT_WIDTH - FIELD_LABEL_WIDTH,
      lineBreak: false,
    })
  doc.x = PAGE_MARGIN
  doc.y = y + 14
}

function paragraph(doc: PDFKit.PDFDocument, text: string | undefined): void {
  ensureSpace(doc, 20)
  const y = doc.y
  const hasText = Boolean(text?.trim())
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor(hasText ? COLOR_TEXT : COLOR_MUTED)
    .text(hasText ? text!.trim() : 'Not yet provided', PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: 'left',
    })
  doc.x = PAGE_MARGIN
  doc.y = Math.max(doc.y, y + 14) + 6
}

function bulletList(doc: PDFKit.PDFDocument, items: string[] | undefined): void {
  const real = (items ?? []).filter((i) => i.trim())
  if (real.length === 0) {
    paragraph(doc, undefined)
    return
  }
  for (const item of real) {
    ensureSpace(doc, 14)
    const y = doc.y
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(COLOR_TEXT)
      .text(`•  ${item.trim()}`, PAGE_MARGIN, y, { width: CONTENT_WIDTH })
    doc.x = PAGE_MARGIN
    doc.y = Math.max(doc.y, y + 14)
  }
  doc.y += 6
}

/**
 * Real-usage content, 11 Sep 2026 — renders a real PSMF PDF from a
 * draft's own structured `content`, matching `AuditPackPdfService`'s
 * exact style/helper conventions (same color palette, same
 * `ensureSpace`/`sectionHeader` pattern) so every generated document in
 * this app reads as one consistent family, not several one-off
 * renderers. The resulting buffer becomes the PSMF's own `documentId`
 * via the normal `DocumentsService.uploadDirect()` path
 * (`PsmfService.generateDocument()`) — the exact same field the manual
 * "upload an existing PSMF" path already writes to.
 */
@Injectable()
export class PsmfPdfService {
  async render(data: PsmfPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderCoverBlock(doc, data)
    this.renderSection1Qppv(doc, data)
    this.renderSection2Org(doc, data)
    this.renderSection3Sources(doc, data)
    this.renderSection4Systems(doc, data)
    this.renderSection5Sops(doc, data)
    this.renderSection6Qms(doc, data)
    this.renderSection7Appendices(doc, data)
    this.renderSignOff(doc, data)

    doc.end()
    return result
  }

  private renderCoverBlock(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('Pharmacovigilance System Master File (PSMF)')
    doc.moveDown(0.3)
    field(doc, 'MAH / LTR Name:', data.companyName)
    field(doc, 'PSMF Reference Number:', data.content.reference?.psmfReferenceNumber)
    field(
      doc,
      'Main Location of PV Activities:',
      data.content.reference?.mainLocationOfPvActivities,
    )
    field(
      doc,
      'Current Version & Status:',
      `Version ${data.version}, ${data.status === 'active' ? 'Approved' : 'Draft'}`,
    )
    field(doc, 'Date of This Version:', data.createdAt.toISOString().slice(0, 10))
    doc.moveDown(1)
  }

  private renderSection1Qppv(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 1: Qualified Person for Pharmacovigilance (QPPV)')
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('1.1 Details of the Primary Local QPPV')
    doc.moveDown(0.2)
    const primary = data.content.qppv?.primary
    field(doc, 'Full Name:', primary?.fullName)
    field(doc, 'Professional Qualification:', primary?.professionalQualification)
    field(doc, 'Professional Board Registration No:', primary?.professionalBoardRegistrationNo)
    field(doc, 'Physical Work Address:', primary?.physicalWorkAddress)
    field(doc, '24/7 Emergency Mobile Number:', primary?.emergencyMobileNumber)
    field(doc, 'Official Corporate Email:', primary?.officialEmail)
    doc.moveDown(0.4)

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('1.2 Details of the Deputy / Backup QPPV')
    doc.moveDown(0.2)
    const backup = data.content.qppv?.backup
    field(doc, 'Full Name:', backup?.fullName)
    field(doc, 'Official Contact Email:', backup?.contactEmail)
    field(doc, 'Official Contact Phone:', backup?.contactPhone)
    doc.moveDown(0.6)
  }

  private renderSection2Org(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 2: Organizational Structure of the MAH')
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('2.1 Corporate Structure and Governance')
    doc.moveDown(0.2)
    paragraph(doc, data.content.organizationalStructure?.corporateGovernanceNarrative)

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('2.2 Local Technical Representative (LTR) Footprint')
    doc.moveDown(0.2)
    field(doc, 'Company Registered Name:', data.content.organizationalStructure?.ltrRegisteredName)
    field(
      doc,
      'Physical Premise License Number:',
      data.content.organizationalStructure?.ltrPremiseLicenseNumber,
    )
    field(doc, 'Scope of Operations:', data.content.organizationalStructure?.ltrScopeOfOperations)
    doc.moveDown(0.6)
  }

  private renderSection3Sources(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 3: Sources of Safety Data')
    bulletList(doc, data.content.sourcesOfSafetyData)
    doc.moveDown(0.4)
  }

  private renderSection4Systems(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 4: Computerized Systems and Databases')
    const systems = data.content.computerizedSystems
    field(doc, 'Local Intake/Tracking Tool:', systems?.localTrackingTool)
    field(doc, 'Global Safety Database:', systems?.globalSafetyDatabase)
    field(doc, 'Primary Submission Portal:', systems?.submissionPortal)
    field(doc, 'Data Backup / Business Continuity:', systems?.dataBackupProtocol)
    doc.moveDown(0.6)
  }

  private renderSection5Sops(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 5: Pharmacovigilance Processes (SOPs)')
    const sops = (data.content.sops ?? []).filter((s) => s.reference?.trim() || s.title?.trim())
    if (sops.length === 0) {
      paragraph(doc, undefined)
      return
    }
    const colWidths = [90, CONTENT_WIDTH - 90 - 80, 80]
    ensureSpace(doc, 20)
    let y = doc.y
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 18).fill(COLOR_ROW_ALT)
    doc.fillColor(COLOR_TEXT).fontSize(8).font('Helvetica-Bold')
    doc.text('Reference', PAGE_MARGIN + 4, y + 5, { width: colWidths[0] })
    doc.text('Title', PAGE_MARGIN + colWidths[0] + 4, y + 5, { width: colWidths[1] })
    doc.text('Version', PAGE_MARGIN + colWidths[0] + colWidths[1] + 4, y + 5, {
      width: colWidths[2],
    })
    doc.y = y + 18
    doc.font('Helvetica').fontSize(8)
    for (const sop of sops) {
      ensureSpace(doc, 16)
      y = doc.y
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 16).strokeColor(COLOR_BORDER).stroke()
      doc.fillColor(COLOR_TEXT)
      doc.text(sop.reference || '—', PAGE_MARGIN + 4, y + 4, { width: colWidths[0] })
      doc.text(sop.title || '—', PAGE_MARGIN + colWidths[0] + 4, y + 4, { width: colWidths[1] })
      doc.text(sop.version || '—', PAGE_MARGIN + colWidths[0] + colWidths[1] + 4, y + 4, {
        width: colWidths[2],
      })
      doc.y = y + 16
    }
    doc.moveDown(0.6)
  }

  private renderSection6Qms(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 6: Quality Management System (QMS)')
    const qms = data.content.qms
    field(doc, 'PV Awareness Training Cadence:', qms?.trainingCadence)
    field(doc, 'Internal Audit Cadence:', qms?.internalAuditCadence)
    field(doc, 'CAPA Review Cadence:', qms?.capaReviewCadence)
    doc.moveDown(0.6)
  }

  private renderSection7Appendices(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'Section 7: Appendices (List of Attachments)')
    bulletList(doc, data.content.appendices)
    doc.moveDown(0.4)
  }

  private renderSignOff(doc: PDFKit.PDFDocument, data: PsmfPdfData): void {
    sectionHeader(doc, 'PSMF Authorization and Sign-Off')
    doc.fontSize(9).font('Helvetica').fillColor(COLOR_TEXT)
    doc.text(
      `Prepared and Maintained By: ${data.content.qppv?.primary?.fullName || 'Not yet provided'}`,
    )
    doc.text('Qualified Person for Pharmacovigilance')
    doc.moveDown(0.6)
    doc.text('Signature: ___________________________     Date: ___________________________')
    doc.moveDown(1)
    doc.text('Approved By: ___________________________')
    doc.text('Country Manager / LTR Representative')
    doc.moveDown(0.6)
    doc.text('Signature: ___________________________     Date: ___________________________')
  }
}
