import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 56
const PAGE_WIDTH = 595.28 // A4 pt
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2
const PAGE_HEIGHT = 841.89 // A4 pt

export interface SafetyLetterData {
  letterType: 'dhcp' | 'dil'
  companyName: string
  productName: string | null
  alertTitle: string
  alertSummary: string
  ppbApprovalReference: string
  backgroundInformation: string
  actionableGuidance: string
  signatoryName: string
  signatoryTitle: string
  regulatoryContactEmail: string | null
  regulatoryContactPhone: string | null
  registeredAddress: string | null
  generatedAt: Date
}

const LETTER_TITLES: Record<SafetyLetterData['letterType'], string> = {
  dhcp: 'Dear Healthcare Professional Letter',
  dil: 'Dear Investigator Letter',
}

const SALUTATIONS: Record<SafetyLetterData['letterType'], string> = {
  dhcp: 'Dear Healthcare Professional,',
  dil: 'Dear Investigator,',
}

/**
 * VigiCloud Stage 18, rebuilt 11 Sep 2026 against the real `Draft Kenya
 * DHCPL.docx` sample document, per the "vigicloud document formats are
 * samples, the corresponding generated document should have the exact
 * same content type and form — it's a standard" instruction. The real
 * letter's structure: a header block (title, PPB Approval Reference, Date
 * of Distribution), an "URGENT MEDICAL/SAFETY ALERT" subject line, a
 * salutation, four labelled sections (Summary of Critical Safety
 * Information; Background Information & Clinical Relevance; Actionable
 * Guidance for Healthcare Providers; Reporting Obligation for Adverse
 * Reactions — the last one boilerplate, naming the PvERS Portal/mPvERS app
 * and the MAH's own local contact), a Company Contact Details block, and a
 * "Yours faithfully," sign-off naming a real signatory and title. Every
 * `.text()` call below pins explicit `x`/`y` and manages `doc.x`/`doc.y`
 * itself — the same ambient-cursor-leak bug class already documented in
 * CLAUDE.md for `periodic-report-pdf.service.ts` and fixed the same way in
 * `psmf-pdf.service.ts`.
 */
@Injectable()
export class SafetyLetterPdfService {
  async render(data: SafetyLetterData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    let y = PAGE_MARGIN

    const ensureSpace = (needed: number) => {
      if (y + needed > PAGE_HEIGHT - PAGE_MARGIN) {
        doc.addPage()
        y = PAGE_MARGIN
      }
    }

    const paragraph = (
      text: string,
      opts: {
        size?: number
        bold?: boolean
        color?: string
        gapAfter?: number
        align?: 'left' | 'justify'
      } = {},
    ) => {
      const size = opts.size ?? 10.5
      doc
        .fontSize(size)
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(opts.color ?? '#111111')
      const height = doc.heightOfString(text, { width: CONTENT_WIDTH, align: opts.align ?? 'left' })
      ensureSpace(height + (opts.gapAfter ?? 10))
      doc.text(text, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: opts.align ?? 'left' })
      y += height + (opts.gapAfter ?? 10)
      doc.fillColor('#000000')
    }

    const sectionHeader = (title: string) => {
      ensureSpace(24)
      doc.fontSize(11.5).font('Helvetica-Bold').fillColor('#0C5446')
      doc.text(title, PAGE_MARGIN, y, { width: CONTENT_WIDTH })
      y += 18
      doc.fillColor('#000000')
    }

    // Header block
    paragraph(LETTER_TITLES[data.letterType], { size: 15, bold: true, gapAfter: 6 })
    paragraph(`PPB Approval Reference: ${data.ppbApprovalReference}`, {
      size: 9.5,
      color: '#555555',
      gapAfter: 2,
    })
    paragraph(`Date of Distribution: ${data.generatedAt.toISOString().slice(0, 10)}`, {
      size: 9.5,
      color: '#555555',
      gapAfter: 2,
    })
    paragraph(
      `Issued by ${data.companyName}${data.productName ? ` — Product: ${data.productName}` : ''}`,
      { size: 9.5, color: '#555555', gapAfter: 14 },
    )

    // Subject line
    paragraph('URGENT MEDICAL/SAFETY ALERT', {
      size: 12,
      bold: true,
      color: '#B3261E',
      gapAfter: 14,
    })

    // Salutation
    paragraph(SALUTATIONS[data.letterType], { gapAfter: 12 })

    // Summary of Critical Safety Information
    sectionHeader('Summary of Critical Safety Information')
    paragraph(data.alertTitle, { bold: true, gapAfter: 4 })
    paragraph(data.alertSummary, { align: 'justify', gapAfter: 14 })

    // Background Information & Clinical Relevance
    sectionHeader('Background Information & Clinical Relevance')
    paragraph(data.backgroundInformation, { align: 'justify', gapAfter: 14 })

    // Actionable Guidance for Healthcare Providers
    sectionHeader('Actionable Guidance for Healthcare Providers')
    paragraph(data.actionableGuidance, { align: 'justify', gapAfter: 14 })

    // Reporting Obligation for Adverse Reactions — boilerplate, real regulatory-contact fallback
    sectionHeader('Reporting Obligation for Adverse Reactions')
    const contactLine =
      data.regulatoryContactEmail || data.regulatoryContactPhone
        ? `your Marketing Authorization Holder's local contact (${[data.regulatoryContactEmail, data.regulatoryContactPhone].filter(Boolean).join(' / ')})`
        : "your Marketing Authorization Holder's local contact"
    paragraph(
      `Healthcare professionals and patients are reminded of their obligation to report any suspected adverse reaction or quality defect associated with this product. Reports may be submitted via the PvERS Portal, the mPvERS mobile application, or directly to ${contactLine}. Timely reporting supports ongoing product safety monitoring.`,
      { align: 'justify', gapAfter: 16 },
    )

    // Company Contact Details
    sectionHeader('Company Contact Details')
    paragraph(data.companyName, { bold: true, gapAfter: 2 })
    if (data.registeredAddress)
      paragraph(data.registeredAddress, { size: 9.5, color: '#555555', gapAfter: 2 })
    if (data.regulatoryContactEmail)
      paragraph(`Email: ${data.regulatoryContactEmail}`, {
        size: 9.5,
        color: '#555555',
        gapAfter: 2,
      })
    if (data.regulatoryContactPhone)
      paragraph(`Phone: ${data.regulatoryContactPhone}`, {
        size: 9.5,
        color: '#555555',
        gapAfter: 20,
      })
    if (!data.registeredAddress && !data.regulatoryContactEmail && !data.regulatoryContactPhone) {
      paragraph('Not yet provided — add company contact details via Company Profile.', {
        size: 9.5,
        color: '#888888',
        gapAfter: 20,
      })
    }

    // Sign-off
    paragraph('Yours faithfully,', { gapAfter: 30 })
    paragraph(data.signatoryName, { bold: true, gapAfter: 2 })
    paragraph(data.signatoryTitle, { size: 9.5, color: '#555555', gapAfter: 2 })
    paragraph(data.companyName, { size: 9.5, color: '#555555', gapAfter: 0 })

    doc.end()
    return result
  }
}
