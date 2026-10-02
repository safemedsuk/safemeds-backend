import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

import { InspectionReadinessSnapshot } from './inspection-readiness.service'

const PAGE_MARGIN = 40
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2

const COLOR_BAR = '#0F6B66'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#1F2937'
const COLOR_MUTED = '#6B7280'
const COLOR_BORDER = '#D1D5DB'
const COLOR_ROW_ALT = '#F3F4F6'

export interface InspectionReadinessPdfData {
  companyName: string
  generatedAt: Date
  snapshot: InspectionReadinessSnapshot
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }
}

/**
 * Matches `AuditPackPdfService`'s own established shape exactly,
 * including its own hard-won pdfkit-ambient-cursor fix (`doc.x`/`doc.y`
 * explicitly reset after every section bar, never left to the ambient
 * flow cursor — see this codebase's own gotchas list for the three
 * prior times this exact bug class was found).
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

/**
 * QualCloud (Phase 13) Stage 9 — "one-click evidence-pack generation,"
 * reusing the exact same pdfkit pattern VigiCloud's own Audit Pack
 * (Stage 16.2) already established.
 */
@Injectable()
export class InspectionReadinessPdfService {
  async render(data: InspectionReadinessPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderHeader(doc, data)
    this.renderSummary(doc, data)
    this.renderChecklistTable(doc, data)

    doc.end()
    return result
  }

  private renderHeader(doc: PDFKit.PDFDocument, data: InspectionReadinessPdfData): void {
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('Inspection Readiness Pack', { align: 'left' })
    doc.fontSize(11).font('Helvetica').fillColor(COLOR_MUTED).text(data.companyName)
    doc.text(`Generated ${data.generatedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`)
    doc.text(`Home market: ${data.snapshot.homeCountryName}`)
    doc.moveDown(1)
  }

  private renderSummary(doc: PDFKit.PDFDocument, data: InspectionReadinessPdfData): void {
    sectionHeader(doc, 'Overall Readiness')
    doc.fontSize(10).fillColor(COLOR_TEXT).text(`Status: ${data.snapshot.overall.toUpperCase()}`)
    const readyCount = data.snapshot.rows.filter((r) => r.status === 'ready').length
    doc.text(`Sections ready: ${readyCount} / ${data.snapshot.rows.length}`)
    if (!data.snapshot.authorityConfigured) {
      doc.fillColor('#B45309').text('No regulatory authority is configured for this market yet.')
      doc.fillColor(COLOR_TEXT)
    }
    doc.moveDown(1)
  }

  private renderChecklistTable(doc: PDFKit.PDFDocument, data: InspectionReadinessPdfData): void {
    sectionHeader(doc, 'Checklist')

    const colWidths = [150, 90, CONTENT_WIDTH - 150 - 90]
    this.renderTableRow(doc, ['Section', 'Status', 'Note'], colWidths, true)

    data.snapshot.rows.forEach((row, idx) => {
      ensureSpace(doc, 24)
      if (idx % 2 === 1) {
        doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 22).fill(COLOR_ROW_ALT)
        doc.fillColor(COLOR_TEXT)
      }
      this.renderTableRow(
        doc,
        [row.title, row.status === 'ready' ? 'Ready' : 'Needs Attention', row.note],
        colWidths,
        false,
      )
    })
  }

  private renderTableRow(
    doc: PDFKit.PDFDocument,
    cells: string[],
    colWidths: number[],
    isHeader: boolean,
  ): void {
    const y = doc.y
    doc
      .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(8.5)
      .fillColor(COLOR_TEXT)
    let x = PAGE_MARGIN
    cells.forEach((cell, i) => {
      doc.text(cell, x + 2, y, { width: colWidths[i] - 4 })
      x += colWidths[i]
    })
    doc.x = PAGE_MARGIN
    doc.y = y + 22
    if (isHeader) {
      doc
        .moveTo(PAGE_MARGIN, doc.y)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y)
        .strokeColor(COLOR_BORDER)
        .stroke()
      doc.moveDown(0.3)
    }
  }
}
