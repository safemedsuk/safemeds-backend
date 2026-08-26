import { Injectable } from '@nestjs/common'
import { existsSync } from 'fs'
import { join } from 'path'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 40
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2 // A4 width in points, minus margins

const COLOR_BAR = '#0F6B66'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#1F2937'
const COLOR_MUTED = '#6B7280'
const COLOR_BORDER = '#D1D5DB'
const COLOR_ROW_ALT = '#F3F4F6'

export interface RegSubmissionCoverSheetData {
  authority: {
    name: string
    formCode: string | null
    ministryName: string | null
    poBoxAddress: string | null
    phone: string | null
    contactEmail: string | null
    emblemAssetKey: string | null
  }
  emblemBuffer: Buffer | null
  countryOfficialName: string
  companyName: string
  productBrandName: string
  productClass: string
  route: string
  submissionNumber: number
  generatedAt: Date
  generatedByName: string
  documents: { label: string; ctdModule: string | null; filename: string }[]
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * RegCloud (Phase 12) Stage 4 — a real transmittal cover sheet, not a
 * full replica of every enclosed document (those are the dossier's own
 * already-uploaded `Document` rows — see `RegSubmissionService.generate()`).
 * The letterhead rendering is a direct, self-contained adaptation of
 * `RegulatorySubmissionPdfService`'s own (VigiCloud Stage 12), copied
 * rather than shared to avoid a cross-module dependency between
 * `RegulatoryModule` and `RegulatorySubmissionModule` purely for a few
 * dozen lines of letterhead drawing — same visual language (colors,
 * emblem placement, letterhead structure), different content beneath
 * it. Genuinely country/authority-agnostic: degrades to a clean,
 * honest, text-only header for any authority whose letterhead content
 * isn't sourced yet — never a placeholder or a fabricated emblem.
 */
@Injectable()
export class RegSubmissionPdfService {
  async render(data: RegSubmissionCoverSheetData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderLetterhead(doc, data)
    this.renderTransmittalDetails(doc, data)
    this.renderDocumentsList(doc, data)
    this.renderCertification(doc, data)

    doc.end()
    return result
  }

  private renderLetterhead(doc: PDFKit.PDFDocument, data: RegSubmissionCoverSheetData): void {
    const { authority } = data

    if (authority.formCode) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLOR_MUTED)
        .text(authority.formCode, PAGE_MARGIN, PAGE_MARGIN)
      doc.moveDown(0.5)
    }

    let y = doc.y
    const emblemSource =
      data.emblemBuffer ??
      (authority.emblemAssetKey ? this.resolveEmblemPath(authority.emblemAssetKey) : null)
    if (emblemSource) {
      const emblemWidth = 60
      doc.image(emblemSource, PAGE_MARGIN + CONTENT_WIDTH / 2 - emblemWidth / 2, y, {
        width: emblemWidth,
      })
      y += 56
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR_TEXT)
    doc.text(data.countryOfficialName.toUpperCase(), PAGE_MARGIN, y, {
      width: CONTENT_WIDTH,
      align: 'center',
    })
    y = doc.y + 4

    if (authority.ministryName) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(authority.ministryName.toUpperCase(), PAGE_MARGIN, y, {
          width: CONTENT_WIDTH,
          align: 'center',
        })
      y = doc.y + 2
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(authority.name.toUpperCase(), PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: 'center' })
    y = doc.y + 4

    doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED)
    const contactLine = [
      authority.poBoxAddress,
      authority.phone ? `Tel: ${authority.phone}` : null,
      authority.contactEmail ? `Email: ${authority.contactEmail}` : null,
    ]
      .filter(Boolean)
      .join('   ·   ')
    if (contactLine) {
      doc.text(contactLine, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: 'center' })
      y = doc.y + 8
    } else {
      y += 8
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(COLOR_BAR)
      .text('Regulatory Dossier Submission — Cover Sheet', PAGE_MARGIN, y, {
        width: CONTENT_WIDTH,
        align: 'center',
      })
    doc.y += 10
    doc
      .moveTo(PAGE_MARGIN, doc.y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
      .strokeColor(COLOR_BORDER)
      .lineWidth(1)
      .stroke()
    doc.moveDown(1)
  }

  private resolveEmblemPath(assetKey: string): string | null {
    const safeKey = assetKey.replace(/[^a-zA-Z0-9-_]/g, '')
    // Reuses the same bundled, version-controlled emblem assets VigiCloud's
    // own E2B PDF renders from — a static file reference, not a module
    // dependency, so this stays self-contained (see this class's own doc
    // comment for why the letterhead code itself isn't shared directly).
    const path = join(
      __dirname,
      '..',
      'regulatory-submission',
      'assets',
      'emblems',
      `${safeKey}.png`,
    )
    return existsSync(path) ? path : null
  }

  private sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
    const y = doc.y
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 20).fill(COLOR_BAR)
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(COLOR_BAR_TEXT)
      .text(title, PAGE_MARGIN + 8, y + 5.5)
    doc.y = y + 28
    doc.fillColor(COLOR_TEXT)
  }

  private field(doc: PDFKit.PDFDocument, label: string, value: string): void {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLOR_MUTED)
      .text(label.toUpperCase(), { continued: false })
    doc.font('Helvetica').fontSize(10).fillColor(COLOR_TEXT).text(value)
    doc.moveDown(0.4)
  }

  private renderTransmittalDetails(
    doc: PDFKit.PDFDocument,
    data: RegSubmissionCoverSheetData,
  ): void {
    this.sectionHeader(doc, 'Transmittal Details')
    this.field(doc, 'Submitting Company', data.companyName)
    this.field(doc, 'Product', data.productBrandName)
    this.field(doc, 'Product Class', data.productClass)
    if (data.route !== '*') this.field(doc, 'Route of Administration', data.route)
    this.field(
      doc,
      'Submission Number',
      `#${data.submissionNumber}${data.submissionNumber > 1 ? ' (resubmission)' : ''}`,
    )
    this.field(doc, 'Generated', `${formatDate(data.generatedAt)} by ${data.generatedByName}`)
    doc.moveDown(0.6)
  }

  private renderDocumentsList(doc: PDFKit.PDFDocument, data: RegSubmissionCoverSheetData): void {
    this.sectionHeader(doc, 'Enclosed Documents')
    if (data.documents.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text('No documents were attached to this dossier at the time of generation.')
      doc.moveDown(0.6)
      return
    }
    data.documents.forEach((d, idx) => {
      if (idx % 2 === 1) {
        doc.rect(PAGE_MARGIN, doc.y - 2, CONTENT_WIDTH, 16).fill(COLOR_ROW_ALT)
        doc.fillColor(COLOR_TEXT)
      }
      const line = [d.label, d.ctdModule, d.filename].filter(Boolean).join('  —  ')
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLOR_TEXT)
        .text(`${idx + 1}. ${line}`, PAGE_MARGIN + 4, doc.y, { width: CONTENT_WIDTH - 8 })
    })
    doc.moveDown(0.6)
  }

  private renderCertification(doc: PDFKit.PDFDocument, data: RegSubmissionCoverSheetData): void {
    this.sectionHeader(doc, 'Certification')
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text(
        `${data.companyName} hereby submits the enclosed documents to ${data.authority.name} in support of the registration of ${data.productBrandName}, in accordance with the applicable regulatory requirements.`,
        { width: CONTENT_WIDTH },
      )
    doc.moveDown(2)
    doc.text('Signature: _______________________________', PAGE_MARGIN, doc.y)
    doc.moveDown(0.8)
    doc.text(`Name: ${data.generatedByName}`, PAGE_MARGIN, doc.y)
    doc.moveDown(0.5)
    doc.text(`Date: ${formatDate(data.generatedAt)}`, PAGE_MARGIN, doc.y)
  }
}
