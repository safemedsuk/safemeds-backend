import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

import { AuditReadinessDashboard } from './audit-readiness.service'

const PAGE_MARGIN = 40
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2

const COLOR_BAR = '#0F6B66'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#1F2937'
const COLOR_MUTED = '#6B7280'
const COLOR_BORDER = '#D1D5DB'
const COLOR_ROW_ALT = '#F3F4F6'

const STATUS_LABELS: Record<string, string> = {
  ready: 'Ready',
  needs_update: 'Needs Update',
  expiring: 'Expiring',
  missing: 'Missing',
}

export interface AuditPackPdfData {
  companyName: string
  generatedAt: Date
  dashboard: AuditReadinessDashboard
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage()
  }
}

/**
 * Real-document-fidelity pass, 12 Sep 2026 — found and fixed the same
 * pdfkit ambient-cursor bug class already documented for
 * `periodic-report-pdf.service.ts`/`psmf-pdf.service.ts`: the title
 * `.text()` call left `doc.x` at `PAGE_MARGIN + 8` (its own explicit x),
 * so every following ambient (no-x) `.text()` call in this section
 * inherited that indent instead of the real page margin. Both `doc.x`/
 * `doc.y` are now explicitly reset after the bar, never left to the
 * ambient flow cursor.
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
 * VigiCloud Stage 16.2 — "Generate audit pack": a dated, indexed cover
 * sheet, matching Stage 12's own "generate a PDF, store it through the
 * normal Documents pipeline" precedent rather than a bytes-bundling zip
 * — see `AuditPack`'s own schema doc comment for the full reasoning.
 */
@Injectable()
export class AuditPackPdfService {
  async render(data: AuditPackPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderHeader(doc, data)
    this.renderSummary(doc, data)
    this.renderRequirementsTable(doc, data)

    doc.end()
    return result
  }

  private renderHeader(doc: PDFKit.PDFDocument, data: AuditPackPdfData): void {
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .fillColor(COLOR_TEXT)
      .text('PV Audit-Readiness Pack', { align: 'left' })
    doc.fontSize(11).font('Helvetica').fillColor(COLOR_MUTED).text(data.companyName)
    doc.text(`Generated ${data.generatedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`)
    doc.moveDown(1)
  }

  private renderSummary(doc: PDFKit.PDFDocument, data: AuditPackPdfData): void {
    const { overall, readyCount, totalMandatory } = data.dashboard
    sectionHeader(doc, 'Overall Readiness')
    doc.fontSize(10).fillColor(COLOR_TEXT).text(`Status: ${overall.toUpperCase()}`)
    doc.text(`Mandatory requirements ready: ${readyCount} / ${totalMandatory}`)
    doc.moveDown(1)
  }

  private renderRequirementsTable(doc: PDFKit.PDFDocument, data: AuditPackPdfData): void {
    sectionHeader(doc, 'Requirement Checklist')

    const colWidths = [24, 220, 90, 60, CONTENT_WIDTH - 24 - 220 - 90 - 60]
    const headers = ['#', 'Requirement', 'Status', 'Mandatory', 'Evidence']
    this.renderTableRow(doc, headers, colWidths, true)

    data.dashboard.rows.forEach((row, idx) => {
      ensureSpace(doc, 20)
      if (idx % 2 === 1) {
        doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 18).fill(COLOR_ROW_ALT)
        doc.fillColor(COLOR_TEXT)
      }
      this.renderTableRow(
        doc,
        [
          String(row.sortOrder),
          row.title,
          STATUS_LABELS[row.status] ?? row.status,
          row.isMandatory ? 'Yes' : 'No',
          row.evidenceDocumentId ? 'Attached' : '—',
        ],
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
      .fillColor(isHeader ? COLOR_TEXT : COLOR_TEXT)
    let x = PAGE_MARGIN
    cells.forEach((cell, i) => {
      doc.text(cell, x + 2, y, { width: colWidths[i] - 4 })
      x += colWidths[i]
    })
    doc.y = y + 18
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
