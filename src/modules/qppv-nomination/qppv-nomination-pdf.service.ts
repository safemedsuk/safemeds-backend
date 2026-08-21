import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 56
const BLANK = '________________________________'

export interface QppvNominationCounterpart {
  fullName: string
  email: string
}

export interface QppvNominationLetterData {
  companyName: string
  registeredAddress: string | null
  regulatoryContactEmail: string | null
  qppvFullName: string
  qppvEmail: string
  role: 'primary' | 'backup'
  nominatedAt: Date
  /**
   * VigiCloud real-usage feedback, 19 Aug 2026 — "update the document
   * generated for this nomination of QPPV for both primary and backup."
   * `setNomination()` still handles primary/backup as two independent
   * actions each producing its own versioned letter (unchanged — a
   * company can legitimately nominate one role weeks before the other),
   * but the real sample template (`vigicloud document formats/Draft
   * Kenya QPPV Nomination template.docx`) names *both* roles in one
   * letter (its own §4, "Backup / Deputy QPPV Details"). Passing the
   * already-appointed counterpart here (whichever role isn't being
   * nominated right now) lets each letter reference the other, matching
   * the real template's own structure, without changing when a letter
   * gets generated.
   */
  counterpart: QppvNominationCounterpart | null
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function bullet(doc: PDFKit.PDFDocument, text: string): void {
  doc.text(`•  ${text}`, { indent: 12 })
  doc.moveDown(0.4)
}

/**
 * VigiCloud Stage 16.4 — real-usage feedback, 19 Aug 2026: rebuilt
 * against the real PPB sample nomination letter
 * (`vigicloud document formats/Draft Kenya QPPV Nomination
 * template.docx`), not the previous minimal generic notice. Structure,
 * the PPB CEO address block, the Pharmacy and Poisons Act (Cap 244)
 * citation, the real 15-calendar-day ADR / 30-calendar-day
 * change-notification timelines (both already confirmed elsewhere in
 * this codebase's own domain knowledge, GUD/022 §6.1), and the
 * nominee's own Acknowledgment-of-Appointment signature block are all
 * transcribed directly from that sample, not paraphrased. Fields the
 * template asks for that `User` has no column for at all (professional
 * qualification beyond role, PPB board registration number, national
 * ID/passport, physical/postal address, mobile number) render as blank
 * fill-in lines for the company to complete by hand — an honest gap,
 * never a fabricated value, matching this project's own established
 * discipline (see `RegulatorySubmissionPdfService`'s own letterhead
 * precedent for the same "blank/absent over guessed" rule).
 * Deliberately still letterhead-free at the top (unlike Stage 12's
 * authority-issued PDF) — this is the *company's own* outbound letter
 * to the regulator, not a document the regulator issues, so it has no
 * real authority emblem to render.
 */
@Injectable()
export class QppvNominationPdfService {
  async render(data: QppvNominationLetterData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN })
    const chunks: Buffer[] = []

    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    const roleLabel =
      data.role === 'primary'
        ? 'Qualified Person for Pharmacovigilance (QPPV)'
        : 'Backup / Deputy Qualified Person for Pharmacovigilance (Backup QPPV)'

    doc.fontSize(9).font('Helvetica').fillColor('#6B7280')
    doc.text(`Our Ref: ${BLANK}`, { continued: false })
    doc.text(`Date: ${formatDate(data.nominatedAt)}`)
    doc.moveDown(1.2)
    doc.fillColor('#000000')

    doc.fontSize(10).font('Helvetica-Bold').text('To:')
    doc.font('Helvetica')
    doc.text('The Chief Executive Officer,')
    doc.text('Pharmacy and Poisons Board,')
    doc.text('Lenana Road, P.O. Box 27663-00506,')
    doc.text('Nairobi, Kenya.')
    doc.moveDown(0.6)
    doc.text('Attn: Department of Product Safety / Pharmacovigilance Unit')
    doc.moveDown(1.2)

    doc.font('Helvetica-Bold').fontSize(11)
    doc.text(
      `SUBJECT: NOMINATION OF THE ${roleLabel.toUpperCase()} FOR ${data.companyName.toUpperCase()} IN KENYA`,
      { align: 'left' },
    )
    doc.moveDown(1)

    doc.font('Helvetica').fontSize(10)
    doc.text('Dear Sir/Madam,')
    doc.moveDown(0.8)

    doc.text(
      `Pursuant to the Pharmacy and Poisons Act (Cap 244) and the current PPB Guidelines for Pharmacovigilance and Post-Marketing Surveillance, we are writing on behalf of ${data.companyName} to formally nominate our designated ${roleLabel} for the Kenyan market, with effect from ${formatDate(data.nominatedAt)}.`,
      { align: 'justify' },
    )
    doc.moveDown(0.8)
    doc.text(
      'The nominee is a resident of Kenya, holds a valid practice license with the relevant professional regulatory body, and possesses the necessary clinical and pharmacovigilance expertise to oversee our product safety portfolio.',
      { align: 'justify' },
    )
    doc.moveDown(1)

    doc.font('Helvetica-Bold').text('1. Personal and Professional Profile')
    doc.font('Helvetica')
    doc.moveDown(0.3)
    bullet(doc, `Full Name of Nominee: ${data.qppvFullName}`)
    bullet(doc, `Professional Qualification: ${BLANK}`)
    bullet(doc, `Professional Board Registration No: ${BLANK}`)
    bullet(doc, `National ID / Passport Number: ${BLANK}`)
    doc.moveDown(0.4)

    doc.font('Helvetica-Bold').text('2. Contact Details & Location')
    doc.font('Helvetica')
    doc.moveDown(0.3)
    bullet(doc, `Physical Work Address: ${BLANK}`)
    bullet(doc, `Postal Address: ${BLANK}`)
    bullet(doc, `Official Mobile Number: ${BLANK}`)
    bullet(doc, `Official Email Address: ${data.qppvEmail}`)
    doc.moveDown(0.4)

    doc.font('Helvetica-Bold').text('3. Scope of Responsibilities')
    doc.font('Helvetica')
    doc.moveDown(0.3)
    doc.text(
      `The nominated ${data.role === 'primary' ? 'QPPV' : 'Backup QPPV'} will serve as our technical liaison to the PPB and shall be held personally accountable for:`,
      { align: 'justify' },
    )
    doc.moveDown(0.4)
    bullet(doc, 'Maintaining and updating our local product Risk Management Plans (RMPs).')
    bullet(
      doc,
      'Resolving and reporting local Serious Adverse Drug Reactions (ADRs) to the PvERS portal within 15 calendar days.',
    )
    bullet(
      doc,
      'Compiling and submitting Periodic Safety Update Reports (PSURs/PBRERs) according to local regulatory cycles.',
    )
    bullet(
      doc,
      'Monitoring, detecting, and managing safety signals arising from our registered products within Kenya.',
    )
    bullet(
      doc,
      'Facilitating pharmacovigilance system audits and inspections conducted by PPB inspectors.',
    )
    doc.moveDown(0.2)

    doc.font('Helvetica-Bold').text('4. Backup / Deputy QPPV Details')
    doc.font('Helvetica')
    doc.moveDown(0.3)
    if (data.role === 'primary') {
      if (data.counterpart) {
        doc.text(
          'In the event that the primary QPPV is absent or unavailable, the following alternative contact is authorized to act on behalf of the company:',
          { align: 'justify' },
        )
        doc.moveDown(0.3)
        bullet(doc, `Full Name of Deputy: ${data.counterpart.fullName}`)
        bullet(doc, `Email: ${data.counterpart.email}`)
      } else {
        doc.text(
          'No backup / deputy QPPV has been nominated as of the date of this letter — filed separately once appointed.',
          { align: 'justify' },
        )
      }
    } else {
      doc.text(
        `This letter formally nominates the above-named individual as Backup / Deputy QPPV, authorized to act on behalf of the company in the event the primary QPPV${
          data.counterpart ? ` (${data.counterpart.fullName}, ${data.counterpart.email})` : ''
        } is absent or unavailable.`,
        { align: 'justify' },
      )
    }
    doc.moveDown(1)

    doc.font('Helvetica-Bold').text('Declaration and Commitment')
    doc.font('Helvetica')
    doc.moveDown(0.3)
    doc.text(
      `${data.companyName} commits to providing the nominated ${data.role === 'primary' ? 'QPPV' : 'Backup QPPV'} with sufficient structural resources, direct authority, and full access to our global safety database to effectively discharge their statutory obligations in Kenya. We will notify the Pharmacy and Poisons Board within 30 calendar days should there be any change in this appointment or the contact data provided.`,
      { align: 'justify' },
    )
    doc.moveDown(0.8)
    doc.text(
      "Please find attached copies of the nominee's Curriculum Vitae (CV), Academic Degrees, and Current Professional Practice License for your evaluation and archiving.",
    )
    doc.moveDown(0.8)
    doc.text('Thank you for your continued support in safeguarding public health.')
    doc.moveDown(1.2)

    doc.text('Yours faithfully,')
    doc.moveDown(2)
    doc.text(`Signature: ${BLANK}`)
    doc.moveDown(0.3)
    doc.text(`Name: ${BLANK}`)
    doc.moveDown(0.3)
    doc.text('Designation: ________________________________')
    doc.moveDown(0.3)
    if (data.registeredAddress) doc.text(`${data.companyName} — ${data.registeredAddress}`)
    else doc.text(`${data.companyName}`)
    if (data.regulatoryContactEmail) doc.text(`Regulatory Contact: ${data.regulatoryContactEmail}`)

    doc.moveDown(1.5)
    doc.font('Helvetica-Bold').fontSize(10.5).text('Acknowledgment of Appointment (By the Nominee)')
    doc.font('Helvetica').fontSize(10)
    doc.moveDown(0.4)
    doc.text(
      `I, ${data.qppvFullName}, do hereby accept the nomination and assume full regulatory responsibility as the ${roleLabel} for ${data.companyName} in Kenya.`,
      { align: 'justify' },
    )
    doc.moveDown(1)
    doc.text(`Signature: ${BLANK}`)
    doc.moveDown(0.3)
    doc.text(`Date: ${BLANK}`)

    doc.moveDown(2)
    doc
      .fontSize(8.5)
      .fillColor('#6B7280')
      .text(
        'This letter is generated by SafeMeds as a starting point for the formal nomination process — SafeMeds does not submit this to the regulator or verify the regulator’s acceptance. Fields shown blank above are not collected by SafeMeds today; complete them by hand (or reissue after updating this record) before submission. Upload the regulator’s own confirmation separately once received.',
        { align: 'justify' },
      )

    doc.end()
    return result
  }
}
