import { Injectable } from '@nestjs/common'
import { existsSync } from 'fs'
import { join } from 'path'
import PDFDocument from 'pdfkit'

import { buildNarrative, formatE2bDate } from './e2b-xml-builder.service'
import { SubmissionCaseData } from './regulatory-submission.types'

const PAGE_MARGIN = 40
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2 // A4 width in points, minus margins

const COLOR_BAR = '#0F6B66'
const COLOR_BAR_TEXT = '#FFFFFF'
const COLOR_TEXT = '#1F2937'
const COLOR_MUTED = '#6B7280'
const COLOR_BORDER = '#D1D5DB'
const COLOR_ROW_ALT = '#F3F4F6'

const REACTION_OUTCOME_LABELS: Record<string, string> = {
  recovered: 'Recovered/Resolved',
  recovering: 'Recovering/Resolving',
  not_recovered: 'Not recovered/Not resolved',
  recovered_with_sequelae: 'Recovered/Resolved with sequelae',
  fatal: 'Fatal',
  unknown: 'Unknown',
}

function formatDate(value: Date | null): string {
  return value ? formatE2bDate(value) : '—'
}

function yn(value: boolean): string {
  return value ? 'Yes' : 'No'
}

/**
 * VigiCloud Stage 12 — the human-readable PDF rendering of an
 * `E2bXmlBuilderService.build()`-shaped case, matching the real PPB E2B
 * report sample's own section layout and order
 * (`vigicloud docs/E2b5318.pdf`): letterhead → Identification →
 * Primary Sources → Sender Info → Patient Characteristics →
 * Reaction(s)/Event(s) table → Drugs table → Narrative. Genuinely
 * country/authority-agnostic: the letterhead is built entirely from
 * `RegulatoryAuthority`'s own (nullable) fields, degrading to a clean
 * text-only header — never a placeholder or a fabricated emblem — for
 * any authority whose real letterhead content hasn't been sourced yet.
 * One deliberate correction of the source sample's own section title:
 * "Study Indetification" is a typo there; this renders "Study
 * Identification".
 */
@Injectable()
export class RegulatorySubmissionPdfService {
  /** A `PDFDocument` is a Node `Readable` stream — its `'data'`/`'end'` events fire asynchronously (via the event loop) even though every render call below is itself synchronous, so this genuinely has to be awaited, not just called and immediately read back. */
  async render(data: SubmissionCaseData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    this.renderLetterhead(doc, data)
    this.renderIdentification(doc, data)
    this.renderPrimarySources(doc, data)
    this.renderSenderInfo(doc, data)
    this.renderStudyIdentification(doc)
    this.renderPatientCharacteristics(doc, data)
    this.renderReactionsTable(doc, data)
    this.renderDrugsTable(doc, data)
    this.renderNarrative(doc, data)

    doc.end()
    return result
  }

  // ── Letterhead ──────────────────────────────────────────────────────

  private renderLetterhead(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    const { authority, countryOfReport } = data

    if (authority.formCode) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLOR_MUTED)
        .text(authority.formCode, PAGE_MARGIN, PAGE_MARGIN)
      doc.moveDown(0.5)
    }

    let y = doc.y
    // Real-usage feedback, 19 Aug 2026 — an admin-uploaded emblem
    // (`data.emblemBuffer`, resolved by `RegulatorySubmissionService`
    // from `authority.emblemObjectKey`) always wins over the bundled,
    // build-time-only asset — every country other than Kenya was
    // previously unable to have a real emblem at all without an engineer
    // committing an image file.
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
    const officialCountryName = countryOfReport.officialName ?? countryOfReport.name
    doc.text(officialCountryName.toUpperCase(), PAGE_MARGIN, y, {
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
      .text('E2B Individual Case Safety Report', PAGE_MARGIN, y, {
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
    const path = join(__dirname, 'assets', 'emblems', `${safeKey}.png`)
    return existsSync(path) ? path : null
  }

  // ── Section building blocks ─────────────────────────────────────────

  private sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
    this.ensureSpace(doc, 28)
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

  /** A label/value field grid, `columns` fields per row — matches the sample PDF's own multi-column field layout. */
  private fieldGrid(
    doc: PDFKit.PDFDocument,
    fields: { label: string; value: string }[],
    columns: 1 | 2 | 3 = 2,
  ): void {
    const colWidth = CONTENT_WIDTH / columns
    for (let i = 0; i < fields.length; i += columns) {
      const row = fields.slice(i, i + columns)
      const rowHeights = row.map((f) =>
        doc
          .font('Helvetica')
          .fontSize(9)
          .heightOfString(f.value || '—', { width: colWidth - 10 }),
      )
      const rowHeight = Math.max(...rowHeights, 12) + 16
      this.ensureSpace(doc, rowHeight)
      const y = doc.y
      row.forEach((f, idx) => {
        const x = PAGE_MARGIN + idx * colWidth
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(COLOR_MUTED)
          .text(f.label.toUpperCase(), x, y, { width: colWidth - 10 })
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLOR_TEXT)
          .text(f.value || '—', x, doc.y + 1, { width: colWidth - 10 })
      })
      doc.y = y + rowHeight
    }
    doc.moveDown(0.3)
  }

  private paragraph(doc: PDFKit.PDFDocument, label: string, text: string): void {
    const height = doc
      .font('Helvetica')
      .fontSize(9)
      .heightOfString(text || '—', { width: CONTENT_WIDTH })
    this.ensureSpace(doc, height + 20)
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(COLOR_MUTED)
      .text(label.toUpperCase(), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH })
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text(text || '—', PAGE_MARGIN, doc.y + 1, { width: CONTENT_WIDTH })
    doc.moveDown(0.6)
  }

  private ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number): void {
    const bottom = doc.page.height - doc.page.margins.bottom
    if (doc.y + neededHeight > bottom) {
      doc.addPage()
    }
  }

  /**
   * A real bordered table with wrapped cell text, alternating row
   * shading, and the header row repeated on every page it spans —
   * the readability bar this stage was explicitly asked to meet.
   */
  private table(
    doc: PDFKit.PDFDocument,
    columns: { header: string; width: number }[],
    rows: string[][],
  ): void {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0)
    const scale = CONTENT_WIDTH / totalWidth
    const scaledColumns = columns.map((c) => ({ ...c, width: c.width * scale }))

    const drawHeaderRow = () => {
      const y = doc.y
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 22).fill('#E5E7EB')
      let x = PAGE_MARGIN
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR_TEXT)
      for (const col of scaledColumns) {
        doc.text(col.header, x + 4, y + 6, { width: col.width - 8 })
        x += col.width
      }
      doc.y = y + 22
    }

    this.ensureSpace(doc, 22 + 20)
    drawHeaderRow()

    rows.forEach((row, rowIndex) => {
      const cellHeights = row.map((cell, i) =>
        doc
          .font('Helvetica')
          .fontSize(8)
          .heightOfString(cell || '—', { width: scaledColumns[i].width - 8 }),
      )
      const rowHeight = Math.max(...cellHeights, 10) + 10

      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        drawHeaderRow()
      }

      const y = doc.y
      if (rowIndex % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fill(COLOR_ROW_ALT)
      }
      let x = PAGE_MARGIN
      doc.font('Helvetica').fontSize(8).fillColor(COLOR_TEXT)
      row.forEach((cell, i) => {
        doc.text(cell || '—', x + 4, y + 5, { width: scaledColumns[i].width - 8 })
        x += scaledColumns[i].width
      })
      doc
        .rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight)
        .strokeColor(COLOR_BORDER)
        .lineWidth(0.5)
        .stroke()
      doc.y = y + rowHeight
    })

    doc.moveDown(0.6)
  }

  // ── Sections ─────────────────────────────────────────────────────────

  private renderIdentification(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    const { case: pvCase, submissionNumber, generatedAt, countryOfReport, company } = data
    const referenceDigits = pvCase.referenceNumber.replace(/[^0-9]/g, '')
    const safetyReportId = `${countryOfReport.isoCode}-${company.name.toUpperCase()}-${referenceDigits}`

    this.sectionHeader(doc, 'Identification of the Case Safety Report')
    this.fieldGrid(
      doc,
      [
        { label: "Sender's Safety Report Unique Identifier", value: safetyReportId },
        {
          label: 'Type of Report',
          value: submissionNumber === 1 ? 'Initial (R1)' : `Follow-up (R${submissionNumber})`,
        },
        { label: 'Date of Creation', value: generatedAt.toLocaleString() },
        { label: 'Date First Received from Source', value: formatDate(pvCase.awarenessDate) },
        { label: 'Worldwide Unique Case Identification', value: pvCase.referenceNumber },
      ],
      2,
    )
    this.paragraph(doc, 'Case Narrative', buildNarrative(data))
  }

  private renderPrimarySources(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    const { reporter } = data
    this.sectionHeader(doc, 'Primary Sources')
    this.fieldGrid(
      doc,
      [
        { label: "Reporter's Name", value: reporter?.fullName ?? 'Not provided' },
        { label: "Reporter's Email Address", value: reporter?.email ?? '' },
        { label: "Reporter's Telephone", value: reporter?.phone ?? '' },
        { label: "Reporter's Organization", value: reporter?.organization ?? '' },
        {
          label: "Reporter's Qualification",
          value:
            reporter?.qualification ??
            (reporter?.reporterType === 'consumer'
              ? 'Consumer or other non-health-professional'
              : ''),
        },
      ],
      2,
    )
  }

  private renderSenderInfo(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    const { company, generatedByUserFullName } = data
    this.sectionHeader(doc, 'Information on Sender of Case Safety Report')
    this.fieldGrid(
      doc,
      [
        { label: "Sender's Name", value: generatedByUserFullName },
        { label: "Sender's Organization", value: company.name },
        { label: "Sender's Email Address", value: company.regulatoryContactEmail ?? '' },
        { label: "Sender's Telephone", value: company.regulatoryContactPhone ?? '' },
        { label: "Sender's Address", value: company.registeredAddress ?? '' },
      ],
      2,
    )
  }

  private renderStudyIdentification(doc: PDFKit.PDFDocument): void {
    // Deliberately kept as its own section, matching the sample's own
    // layout, even though this build never populates it — no literature/
    // study-registration data is captured anywhere in the intake wizard
    // yet, so this renders honestly blank rather than being cut, in case
    // a future intake path (Stage 3.6 literature channel) starts filling it.
    this.sectionHeader(doc, 'Study Identification')
    this.fieldGrid(
      doc,
      [
        { label: 'Study Registration Number', value: '' },
        { label: 'Study Registration Country', value: '' },
        { label: 'Study Name', value: '' },
        { label: 'Sponsor Study Number', value: '' },
      ],
      2,
    )
  }

  private renderPatientCharacteristics(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    const { patient } = data
    this.sectionHeader(doc, 'Patient Characteristics')
    this.fieldGrid(
      doc,
      [
        { label: "Patient's Name or Initials", value: patient?.initials ?? 'PRIVACY' },
        {
          label: "Patient's Age",
          value:
            patient?.ageYears !== null && patient?.ageYears !== undefined
              ? `${patient.ageYears} years`
              : 'N/A',
        },
        { label: "Patient's Date of Birth", value: formatDate(patient?.dateOfBirth ?? null) },
        {
          label: 'Sex',
          value: patient?.sex && patient.sex !== 'unknown' ? patient.sex : 'Unknown',
        },
        { label: 'Body Weight (kg)', value: patient?.weightKg ? String(patient.weightKg) : '' },
        { label: 'Height (cm)', value: patient?.heightCm ? String(patient.heightCm) : '' },
      ],
      3,
    )
    if (patient?.medicalHistory) {
      this.paragraph(
        doc,
        'Relevant Medical History and Concurrent Conditions',
        patient.medicalHistory,
      )
    }
  }

  private renderReactionsTable(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    this.sectionHeader(doc, 'Reaction(s) / Event(s)')
    if (data.adverseEvents.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text('No adverse events captured.', PAGE_MARGIN, doc.y)
      doc.moveDown(0.6)
      return
    }
    this.table(
      doc,
      [
        { header: 'Reaction Name', width: 130 },
        { header: 'Start Date', width: 48 },
        { header: 'MedDRA Code', width: 48 },
        { header: 'Death', width: 30 },
        { header: 'Life Threat.', width: 40 },
        { header: 'Hospital.', width: 36 },
        { header: 'Disabling', width: 36 },
        { header: 'Congen. Anomaly', width: 44 },
        { header: 'Occ. Country', width: 42 },
        { header: 'Outcome', width: 68 },
      ],
      data.adverseEvents.map((ae) => [
        ae.reportedTerm,
        formatDate(ae.onsetDate),
        ae.meddraTerm?.code ?? '—',
        yn(ae.seriousnessDeath),
        yn(ae.seriousnessLifeThreatening),
        yn(ae.seriousnessHospitalization),
        yn(ae.seriousnessDisabling),
        yn(ae.seriousnessCongenitalAnomaly),
        data.countryOfOccurrence.isoCode,
        REACTION_OUTCOME_LABELS[ae.outcome] ?? ae.outcome,
      ]),
    )
  }

  private renderDrugsTable(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    this.sectionHeader(doc, 'Drugs Information')
    if (data.suspectProducts.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLOR_MUTED)
        .text('No suspect/concomitant products captured.', PAGE_MARGIN, doc.y)
      doc.moveDown(0.6)
      return
    }
    this.table(
      doc,
      [
        { header: 'Role', width: 60 },
        { header: 'Drug Name', width: 130 },
        { header: 'Active Substance', width: 130 },
        { header: 'Dose', width: 70 },
        { header: 'Route', width: 60 },
      ],
      data.suspectProducts.map((sp) => [
        sp.drugCharacterization === 'suspect'
          ? 'Suspect'
          : sp.drugCharacterization === 'concomitant'
            ? 'Concomitant'
            : 'Interacting',
        sp.medicinalProduct,
        sp.activeSubstanceName ?? sp.whoDrugTerm?.substanceName ?? '—',
        sp.doseText ?? 'UNK',
        sp.route ?? '—',
      ]),
    )
  }

  private renderNarrative(doc: PDFKit.PDFDocument, data: SubmissionCaseData): void {
    this.sectionHeader(doc, 'Narrative Case Summary and Further Information')
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLOR_TEXT)
      .text(buildNarrative(data), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'left' })
  }
}
