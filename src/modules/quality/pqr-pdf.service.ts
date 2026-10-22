import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

import { ApqrDocumentModel, ApqrTable } from './apqr-document'

/**
 * Phase 2 Pass C — the Annual Product Quality Review PDF. Every text call
 * pins an explicit x and y; the cursor is never inherited (the pdfkit
 * ambient-cursor bug recurred in three earlier PDF services). Verified by
 * a real render read back with `pdftotext -layout`, per CLAUDE.md.
 */

const MARGIN = 50
const PAGE_W = 595
const PAGE_H = 842
const CONTENT_W = PAGE_W - 2 * MARGIN
const BOTTOM = PAGE_H - MARGIN - 8
const CELL_PAD = 4
const GREY = '#e5e7eb'
const RULE = '#cbd5e1'

interface Cursor {
  y: number
}

@Injectable()
export class PqrPdfService {
  async render(model: ApqrDocumentModel): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `Annual Product Quality Review — ${model.header.productName}`,
        Author: 'SafeMeds',
      },
    })
    const chunks: Buffer[] = []
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    const cur: Cursor = { y: MARGIN }
    const newPage = () => {
      doc.addPage()
      cur.y = MARGIN
    }
    const ensure = (height: number) => {
      if (cur.y + height > BOTTOM) newPage()
    }
    const paragraph = (
      text: string,
      opts: { font?: string; size?: number; indent?: number; gap?: number } = {},
    ) => {
      const font = opts.font ?? 'Helvetica'
      const size = opts.size ?? 9
      const x = MARGIN + (opts.indent ?? 0)
      const width = CONTENT_W - (opts.indent ?? 0)
      doc.font(font).fontSize(size)
      const h = doc.heightOfString(text, { width })
      ensure(h)
      doc
        .font(font)
        .fontSize(size)
        .fillColor('#000000')
        .text(text, x, cur.y, { width, lineBreak: true })
      cur.y += h + (opts.gap ?? 4)
    }
    const heading = (text: string, size = 11) => {
      ensure(size + 16)
      cur.y += 6
      paragraph(text, { font: 'Helvetica-Bold', size, gap: 4 })
    }

    const drawHeaderRow = (table: ApqrTable, height: number) => {
      doc.rect(MARGIN, cur.y, CONTENT_W, height).fill(GREY)
      let x = MARGIN
      for (const col of table.columns) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000')
        doc.text(col.label, x + CELL_PAD, cur.y + CELL_PAD, {
          width: col.width - 2 * CELL_PAD,
          lineBreak: true,
        })
        x += col.width
      }
      cur.y += height
    }

    const measureRow = (table: ApqrTable, cells: string[], bold = false): number => {
      let max = 0
      table.columns.forEach((col, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
        const h = doc.heightOfString(cells[i] ?? '', { width: col.width - 2 * CELL_PAD })
        if (h > max) max = h
      })
      return max + 2 * CELL_PAD
    }

    const renderTable = (table: ApqrTable) => {
      heading(table.title, 10)
      if (table.scopeNote) paragraph(table.scopeNote, { size: 8, gap: 4 })
      if (table.rows.length === 0) {
        paragraph(table.emptyText, { size: 8.5, gap: 8 })
        return
      }
      const headerH = Math.max(
        ...table.columns.map((col) => {
          doc.font('Helvetica-Bold').fontSize(7.5)
          return doc.heightOfString(col.label, { width: col.width - 2 * CELL_PAD }) + 2 * CELL_PAD
        }),
      )
      ensure(headerH + 20)
      drawHeaderRow(table, headerH)
      for (const row of table.rows) {
        const rowH = measureRow(table, row)
        if (cur.y + rowH > BOTTOM) {
          newPage()
          drawHeaderRow(table, headerH)
        }
        let x = MARGIN
        table.columns.forEach((col, i) => {
          doc.rect(x, cur.y, col.width, rowH).lineWidth(0.5).stroke(RULE)
          doc.font('Helvetica').fontSize(7.5).fillColor('#000000')
          doc.text(row[i] ?? '', x + CELL_PAD, cur.y + CELL_PAD, {
            width: col.width - 2 * CELL_PAD,
            lineBreak: true,
          })
          x += col.width
        })
        cur.y += rowH
      }
      cur.y += 10
    }

    // ── Title block ───────────────────────────────────────────────────────
    const h = model.header
    paragraph('Annual Product Quality Review', { font: 'Helvetica-Bold', size: 16, gap: 6 })
    paragraph(`Company: ${h.companyName}`, { size: 9.5, gap: 2 })
    paragraph(`Product: ${h.productName}`, { size: 9.5, gap: 2 })
    paragraph(`Period: ${h.periodStart.slice(0, 10)} to ${h.periodEnd.slice(0, 10)}`, {
      size: 9.5,
      gap: 2,
    })
    paragraph(h.periodNote, { size: 7.5, gap: 2 })
    paragraph(
      `Generated: ${h.generatedAt.slice(0, 16).replace('T', ' ')} UTC. Figures are frozen at assembly and do not change after review.`,
      { size: 7.5, gap: 8 },
    )

    // ── Summary ───────────────────────────────────────────────────────────
    const summaryTable: ApqrTable = {
      title: 'Summary',
      scopeNote: null,
      columns: [
        { label: 'Measure', width: 220 },
        { label: 'Value', width: CONTENT_W - 220 },
      ],
      rows: model.summary.map((s) => [s.label, s.value]),
      emptyText: '',
    }
    renderTable(summaryTable)

    // ── Sections ──────────────────────────────────────────────────────────
    heading('Review sections', 11)
    for (const table of model.tables) renderTable(table)

    // ── Conclusions, trends, actions ──────────────────────────────────────
    heading('Conclusions', 11)
    paragraph(h.conclusionsNarrative?.trim() || 'No conclusions narrative was recorded.', {
      size: 9,
      gap: 6,
    })
    heading('Trends', 11)
    paragraph(h.trendsNarrative?.trim() || 'No trends narrative was recorded.', { size: 9, gap: 6 })
    heading('Recommended actions', 11)
    if (h.recommendedActions.length === 0) {
      paragraph('No actions were recommended.', { size: 9, gap: 6 })
    } else {
      h.recommendedActions.forEach((a, i) => {
        paragraph(`${i + 1}. ${a.description}${a.capaOpened ? ' (CAPA opened)' : ''}`, {
          size: 9,
          indent: 10,
          gap: 3,
        })
      })
      cur.y += 4
    }

    // ── Sign-off ──────────────────────────────────────────────────────────
    ensure(110)
    heading('Review and signature', 11)
    paragraph(
      h.reviewedByFullName
        ? `Reviewed and electronically signed by ${h.reviewedByFullName}${h.reviewedAt ? ` on ${h.reviewedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.`
        : 'Not yet signed.',
      { size: 9, gap: 6 },
    )
    ensure(40)
    doc
      .moveTo(MARGIN, cur.y + 22)
      .lineTo(MARGIN + 240, cur.y + 22)
      .lineWidth(0.6)
      .stroke('#000000')
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#000000')
      .text('Signature (electronic record held by SafeMeds)', MARGIN, cur.y + 26, {
        width: 240,
        lineBreak: true,
      })

    // ── Footers ───────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.page.margins.bottom = 0
      doc.font('Helvetica').fontSize(7).fillColor('#555555')
      doc.text(`${h.companyName} · APQR · ${h.productName}`, MARGIN, PAGE_H - 28, {
        width: CONTENT_W - 60,
        lineBreak: false,
      })
      doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_W - MARGIN - 60, PAGE_H - 28, {
        width: 60,
        align: 'right',
        lineBreak: false,
      })
      doc.page.margins.bottom = MARGIN
    }

    doc.end()
    return done
  }
}
