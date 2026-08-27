import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 50
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2

const COLOR_BAR = '#0C5446'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#0A1E24'
const COLOR_MUTED = '#5B7079'

/**
 * Real-document-fidelity request, 12 Sep 2026 — the literal structure of
 * `vigicloud document formats/Drat Kenya RMP.docx`, transcribed part by
 * part, not paraphrased: Product Overview (Part I); Safety Specification
 * — Modules SI/SIV/SVII (Part II); Pharmacovigilance Plan (Part III);
 * Plans for Post-Authorisation Efficacy Studies (Part IV); Risk
 * Minimisation Measures (Part V); Summary (Part VI); Sign-Off. Every
 * field is optional — an incomplete section renders as a "Not yet
 * provided" placeholder, matching `PsmfContent`'s own established
 * precedent, never a fabricated value.
 */
export interface RmpContent {
  header?: {
    dosageFormAndStrength?: string
    mahApplicant?: string
    localTechnicalRepresentative?: string
    dateOfApplication?: string
    rmpVersionAndDate?: string
  }
  partI?: {
    activeSubstance?: string
    atcCode?: string
    indications?: string
    targetPopulation?: string
    productType?: string
    qppvNameAndLicense?: string
  }
  partII?: {
    moduleSI?: { incidencePrevalence?: string; relevantComorbidities?: string }
    moduleSIV?: { exclusionCriteriaReview?: string; kenyanContext?: string }
    moduleSVII?: { identifiedRisks?: string; potentialRisks?: string; missingInformation?: string }
  }
  partIII?: {
    additionalStudiesPlanned?: boolean
    additionalStudiesDescription?: string
  }
  partIV?: {
    mandatedLocalEfficacyStudies?: string
  }
  partV?: {
    additionalToolsRequired?: boolean
    additionalToolsDescription?: string
  }
  partVI?: {
    summary?: string
  }
  signOff?: {
    preparedByName?: string
  }
}

export interface RmpPdfData {
  companyName: string
  productBrandName: string
  version: number
  status: string
  createdAt: Date
  content: RmpContent
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }
}

/** Same safe-cursor discipline as `psmf-pdf.service.ts` — every `.text()` call pins explicit `x`/`y`, `doc.x`/`doc.y` are always reset afterward, never trusting pdfkit's own ambient flow cursor. */
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

function subHeader(doc: PDFKit.PDFDocument, title: string): void {
  ensureSpace(doc, 18)
  const y = doc.y
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .fillColor(COLOR_TEXT)
    .text(title, PAGE_MARGIN, y, { width: CONTENT_WIDTH, lineBreak: false })
  doc.x = PAGE_MARGIN
  doc.y = y + 16
}

const FIELD_LABEL_WIDTH = 220

/** For short, one-line values (dates, codes, names). A genuinely long value here still wraps safely — the row height is measured, never assumed — but `stackedField()` below is the right choice for prose-length content. */
function field(doc: PDFKit.PDFDocument, label: string, value: string | undefined): void {
  ensureSpace(doc, 16)
  const y = doc.y
  const valueWidth = CONTENT_WIDTH - FIELD_LABEL_WIDTH
  const hasValue = Boolean(value?.trim())
  const displayValue = hasValue ? value!.trim() : 'Not yet provided'
  const height = doc
    .fontSize(9)
    .font('Helvetica')
    .heightOfString(displayValue, { width: valueWidth })
  doc
    .font('Helvetica-Bold')
    .fillColor(COLOR_MUTED)
    .text(label, PAGE_MARGIN, y, { width: FIELD_LABEL_WIDTH, lineBreak: false })
  doc
    .font('Helvetica')
    .fillColor(hasValue ? COLOR_TEXT : COLOR_MUTED)
    .text(displayValue, PAGE_MARGIN + FIELD_LABEL_WIDTH, y, { width: valueWidth })
  doc.x = PAGE_MARGIN
  doc.y = y + Math.max(height, 12) + 2
}

/** For prose-length content (module narratives, risk descriptions) — a bold label on its own line, then a full-width wrapped paragraph below it, matching how the real sample document lays out its narrative sections rather than squeezing them into a label/value row. */
function stackedField(doc: PDFKit.PDFDocument, label: string, value: string | undefined): void {
  ensureSpace(doc, 28)
  const y = doc.y
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor(COLOR_MUTED)
    .text(label, PAGE_MARGIN, y, { width: CONTENT_WIDTH, lineBreak: false })
  doc.x = PAGE_MARGIN
  doc.y = y + 13
  paragraph(doc, value, { align: 'justify' })
}

function paragraph(
  doc: PDFKit.PDFDocument,
  text: string | undefined,
  opts: { align?: 'left' | 'justify' } = {},
): void {
  ensureSpace(doc, 20)
  const y = doc.y
  const hasText = Boolean(text?.trim())
  const height = doc
    .fontSize(9)
    .font('Helvetica')
    .heightOfString(hasText ? text!.trim() : 'Not yet provided', {
      width: CONTENT_WIDTH,
      align: opts.align ?? 'left',
    })
  doc
    .fillColor(hasText ? COLOR_TEXT : COLOR_MUTED)
    .text(hasText ? text!.trim() : 'Not yet provided', PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: opts.align ?? 'left',
    })
  doc.x = PAGE_MARGIN
  doc.y = y + height + 8
}

/**
 * Real-document-fidelity request, 12 Sep 2026 — renders a real RMP PDF
 * from a draft's own structured `content`, mirroring
 * `PsmfPdfService`'s exact style/helper conventions. The resulting
 * buffer becomes the RMP's own `documentId` via the normal
 * `DocumentsService.uploadDirect()` path (`RiskManagementPlanService
 * .generateDocument()`) — the same field the manual "upload an
 * existing RMP" path already writes to.
 */
@Injectable()
export class RmpPdfService {
  async render(data: RmpPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderCoverBlock(doc, data)
    this.renderPartI(doc, data)
    this.renderPartII(doc, data)
    this.renderPartIII(doc, data)
    this.renderPartIV(doc, data)
    this.renderPartV(doc, data)
    this.renderPartVI(doc, data)
    this.renderSignOff(doc, data)

    doc.end()
    return result
  }

  private renderCoverBlock(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('KENYA RISK MANAGEMENT PLAN (RMP)')
    doc.moveDown(0.3)
    field(doc, 'Product Name:', data.productBrandName)
    field(doc, 'Dosage Form & Strength:', data.content.header?.dosageFormAndStrength)
    field(doc, 'MAH / Applicant:', data.content.header?.mahApplicant || data.companyName)
    field(
      doc,
      'Local Technical Representative (LTR):',
      data.content.header?.localTechnicalRepresentative,
    )
    field(doc, 'Date of Application:', data.content.header?.dateOfApplication)
    field(
      doc,
      'RMP Version & Date:',
      data.content.header?.rmpVersionAndDate ||
        `Version ${data.version}, ${data.createdAt.toISOString().slice(0, 10)}`,
    )
    field(
      doc,
      'Current Status:',
      data.status === 'active' ? 'Active' : data.status === 'retired' ? 'Retired' : 'Draft',
    )
    doc.moveDown(1)
  }

  private renderPartI(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART I: PRODUCT OVERVIEW')
    const p1 = data.content.partI
    field(doc, 'Active Substance(s):', p1?.activeSubstance)
    field(doc, 'ATC Code:', p1?.atcCode)
    stackedField(doc, 'Approved/Proposed Indication(s):', p1?.indications)
    stackedField(doc, 'Target Population:', p1?.targetPopulation)
    field(doc, 'Innovative / Biological / Biosimilar / Generic:', p1?.productType)
    field(doc, 'Kenya-Resident QPPV Name & PPB License No.:', p1?.qppvNameAndLicense)
    doc.moveDown(0.6)
  }

  private renderPartII(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART II: SAFETY SPECIFICATION')
    const p2 = data.content.partII
    subHeader(doc, 'Module SI: Epidemiology of the Indications and Target Population')
    stackedField(doc, 'Incidence/Prevalence in Kenya:', p2?.moduleSI?.incidencePrevalence)
    stackedField(doc, 'Relevant Co-morbidities:', p2?.moduleSI?.relevantComorbidities)
    doc.moveDown(0.3)

    subHeader(doc, 'Module SIV: Populations Not Studied in Clinical Trials')
    stackedField(doc, 'Exclusion Criteria Review:', p2?.moduleSIV?.exclusionCriteriaReview)
    stackedField(doc, 'Kenyan Context:', p2?.moduleSIV?.kenyanContext)
    doc.moveDown(0.3)

    subHeader(doc, 'Module SVII: Summary of Safety Concerns')
    stackedField(doc, 'Identified Risks:', p2?.moduleSVII?.identifiedRisks)
    stackedField(doc, 'Potential Risks:', p2?.moduleSVII?.potentialRisks)
    stackedField(doc, 'Missing Information:', p2?.moduleSVII?.missingInformation)
    doc.moveDown(0.6)
  }

  private renderPartIII(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART III: PHARMACOVIGILANCE PLAN')
    subHeader(doc, '1. Routine Pharmacovigilance Activities')
    paragraph(
      doc,
      'The LTR and local QPPV will monitor, register, and evaluate all spontaneous adverse drug reactions (ADRs) originating from Kenyan healthcare facilities. All Serious ADRs will be processed and uploaded to the PPB Pharmacovigilance Electronic Reporting System (PvERS) portal within 15 calendar days of awareness. Non-serious events will be archived for aggregate reports. Periodic reviews of the local and global product safety database will be executed monthly by the QPPV.',
      { align: 'justify' },
    )
    subHeader(doc, '2. Additional Pharmacovigilance Activities')
    field(
      doc,
      'Are additional studies planned globally/locally?',
      data.content.partIII?.additionalStudiesPlanned ? 'Yes' : 'No',
    )
    if (data.content.partIII?.additionalStudiesPlanned) {
      paragraph(doc, data.content.partIII?.additionalStudiesDescription, { align: 'justify' })
    }
    doc.moveDown(0.6)
  }

  private renderPartIV(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART IV: PLANS FOR POST-AUTHORISATION EFFICACY STUDIES')
    field(
      doc,
      'Mandated Local Efficacy Studies:',
      data.content.partIV?.mandatedLocalEfficacyStudies || 'None',
    )
    doc.moveDown(0.6)
  }

  private renderPartV(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART V: RISK MINIMIZATION MEASURES')
    subHeader(doc, '1. Routine Risk Minimization Measures')
    paragraph(
      doc,
      'Safety warnings, contraindications, and drug-drug interactions are clearly and explicitly stated in the Summary of Product Characteristics (SmPC) and the Patient Information Leaflet (PIL) distributed with the product in Kenya. All labeling and package inserts are provided in English and/or Kiswahili.',
      { align: 'justify' },
    )
    subHeader(doc, '2. Additional Risk Minimization Measures')
    field(
      doc,
      'Are additional tools required?',
      data.content.partV?.additionalToolsRequired ? 'Yes' : 'No',
    )
    if (data.content.partV?.additionalToolsRequired) {
      paragraph(doc, data.content.partV?.additionalToolsDescription, { align: 'justify' })
    }
    doc.moveDown(0.6)
  }

  private renderPartVI(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'PART VI: SUMMARY OF THE RISK MANAGEMENT PLAN')
    paragraph(doc, data.content.partVI?.summary, { align: 'justify' })
    doc.moveDown(0.4)
  }

  private renderSignOff(doc: PDFKit.PDFDocument, data: RmpPdfData): void {
    sectionHeader(doc, 'SIGN-OFF AND APPROVAL')
    doc.fontSize(9).font('Helvetica').fillColor(COLOR_TEXT)
    field(doc, 'Prepared By:', data.content.signOff?.preparedByName)
    paragraph(doc, 'Qualified Person for Pharmacovigilance (Kenya)')
    doc.moveDown(0.4)
    paragraph(doc, 'Signature: ___________________________     Date: ___________________________')
  }
}
