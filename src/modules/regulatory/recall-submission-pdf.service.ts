import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 56

export interface RecallSubmissionPdfData {
  templateName: string
  companyName: string
  recallRef: string
  productName: string
  reason: string
  countryName: string
  generatedAt: Date
}

/**
 * QualCloud (Phase 13) Stage 10.1 — a deterministic, template-driven
 * PDF, never LLM-generated regulatory text (per the build spec's own
 * explicit instruction — see 10.8's note on where "AI assistance" is
 * and isn't appropriate). Deliberately plain: this is a real, working
 * generation path proving the mechanism end to end; a country's own
 * regulator-specific letterhead/section structure is exactly the kind
 * of per-country content a `RecallRuleSet`'s sign-off author supplies
 * over time, the same honest incompleteness this codebase already
 * accepts for every other authority besides Kenya elsewhere in
 * RegCloud/VigiCloud.
 */
@Injectable()
export class RecallSubmissionPdfService {
  async render(data: RecallSubmissionPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)))
    })

    doc.fontSize(16).font('Helvetica-Bold').text(data.templateName, { align: 'center' })
    doc.moveDown(1)
    doc.fontSize(10).font('Helvetica')
    doc.text(`Company: ${data.companyName}`)
    doc.text(`Recall reference: ${data.recallRef}`)
    doc.text(`Country: ${data.countryName}`)
    doc.text(`Product: ${data.productName}`)
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').text('Reason for recall')
    doc.font('Helvetica').text(data.reason, { width: 483 })
    doc.moveDown(1)
    doc.fontSize(8).fillColor('#666666')
    doc.text(`Generated ${data.generatedAt.toISOString()} by SafeMeds QualCloud`, PAGE_MARGIN)

    doc.end()
    return done
  }
}
