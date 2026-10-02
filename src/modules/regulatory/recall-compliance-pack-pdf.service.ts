import { Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const PAGE_MARGIN = 56
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2 // A4 point width minus margins

export interface RecallCompliancePackData {
  companyName: string
  recallRef: string
  productName: string
  reason: string
  mode: string
  type: string | null
  level: string | null
  status: string
  openedAt: Date | null
  closedAt: Date | null
  riskAssessment: { title: string; severity: number; probability: number; score: number; riskLevel: string } | null
  scopeItems: { productId: string; batchId: string; batchSize: number | null }[]
  countries: {
    countryName: string
    status: string
    class: string | null
    level: string | null
    ruleSetVersion: number | null
    regulatorDecision: string | null
  }[]
  rules: {
    countryName: string
    code: string
    requirementText: string
    sourceDoc: string
    unverified: boolean
    ruleSetStatus: string
  }[]
  transitionHistory: { fromStateKey: string | null; toStateKey: string; occurredAt: Date; actorName: string | null }[]
  distribution: { batchNumber: string; toOrgName: string; qtyUnits: number; date: Date }[]
  stakeholders: { orgName: string; type: string; country: string | null }[]
  cascadeInvites: { stakeholderOrgName: string; status: string }[]
  messages: { channel: string; status: string; isDrill: boolean }[]
  quarantine: { batchNumber: string; fullPacks: number }[]
  returns: { ref: string; qty: number; verdict: string | null; creditStatus: string }[]
  reconciliation: {
    countryName: string
    distributed: number
    recovered: number
    quarantined: number
    accounted: number
    outstanding: number
    destroyed: number
    calculatedAt: Date
  }[]
  discrepancies: { units: number; reason: string; blocking: boolean; status: string }[]
  destruction: { units: number; status: string }[]
  effectivenessChecks: { method: string; sampleSize: number; clear: number; stockFound: number; status: string }[]
  submissions: { countryName: string; templateCode: string; status: string; generatedAt: Date }[]
  investigationCapa: { title: string; correctiveAction: string; status: string } | null
  evidenceCount: number
  generatedAt: Date
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

/**
 * QualCloud (Phase 13) Stage 10.6 — the recall compliance pack, a real
 * 21-section document (cover/executive-summary through country-report
 * annexes) assembled live from every service this stage already
 * built, never a fabricated placeholder. **Applies the
 * already-hard-learned pdfkit ambient-cursor-position lesson from day
 * one** (CLAUDE.md's own thrice-documented gotcha) — every `.text()`
 * call below pins explicit `x`/`width`, and `doc.x`/`doc.y` are reset
 * explicitly after any table so a later ambient call never inherits a
 * stale cursor position. Verified by a real render + `pdftotext
 * -layout` readback, not just a passing unit test.
 */
@Injectable()
export class RecallCompliancePackPdfService {
  private doc!: PDFKit.PDFDocument
  private sectionNumber = 0

  async render(data: RecallCompliancePackData): Promise<Buffer> {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true })
    this.doc = doc
    this.sectionNumber = 0
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

    this.coverPage(data)
    this.section('Recall Overview', () => this.recallOverview(data))
    this.section('Classification & Risk Assessment', () => this.riskAssessmentSection(data))
    this.section('Product & Batch Scope', () => this.scopeSection(data))
    this.section('Country-by-Country Status', () => this.countriesSection(data))
    this.section('Regulatory Rule Provenance', () => this.ruleProvenanceSection(data))
    this.section('Timeline of Key Events', () => this.timelineSection(data))
    this.section('Distribution Summary', () => this.distributionSection(data))
    this.section('Stakeholder Network', () => this.stakeholdersSection(data))
    this.section('Cascade & Downstream Notification Status', () => this.cascadeSection(data))
    this.section('Communications Log Summary', () => this.messagesSection(data))
    this.section('Quarantine Summary', () => this.quarantineSection(data))
    this.section('Returns Summary', () => this.returnsSection(data))
    this.section('Reconciliation (Mass Balance)', () => this.reconciliationSection(data))
    this.section('Discrepancies & Exceptions', () => this.discrepanciesSection(data))
    this.section('Destruction & Disposal Summary', () => this.destructionSection(data))
    this.section('Effectiveness Checks', () => this.effectivenessSection(data))
    this.section('Regulator Submissions', () => this.submissionsSection(data))
    this.section('Root-Cause CAPA', () => this.capaSection(data))
    this.section('Evidence Register', () => this.evidenceSection(data))
    this.section('Country Report Annexes', () => this.annexSection(data))
    this.section('Certification', () => this.certificationSection(data))

    doc.end()
    return done
  }

  private resetCursor(): void {
    this.doc.x = PAGE_MARGIN
  }

  private fullWidthText(text: string, opts: Partial<PDFKit.Mixins.TextOptions> = {}): void {
    this.doc.text(text, PAGE_MARGIN, this.doc.y, { width: CONTENT_WIDTH, ...opts })
    this.resetCursor()
  }

  private coverPage(data: RecallCompliancePackData): void {
    this.doc.fontSize(20).font('Helvetica-Bold')
    this.fullWidthText('Recall Compliance Pack', { align: 'center' })
    this.doc.moveDown(0.5)
    this.doc.fontSize(12).font('Helvetica')
    this.fullWidthText(data.companyName, { align: 'center' })
    this.fullWidthText(`Recall ${data.recallRef}`, { align: 'center' })
    this.doc.moveDown(1)
    this.doc.fontSize(9).fillColor('#666666')
    this.fullWidthText(`Generated ${data.generatedAt.toISOString()} — point-in-time snapshot, never regenerated in place.`, {
      align: 'center',
    })
    this.doc.fillColor('#000000')
  }

  private section(title: string, body: () => void): void {
    this.sectionNumber += 1
    this.doc.addPage()
    this.resetCursor()
    this.doc.fontSize(14).font('Helvetica-Bold')
    this.fullWidthText(`${this.sectionNumber}. ${title}`)
    this.doc.moveDown(0.5)
    this.doc.fontSize(10).font('Helvetica')
    body()
  }

  private keyValueRow(label: string, value: string): void {
    this.doc.font('Helvetica-Bold')
    this.fullWidthText(`${label}: `, { continued: false })
    this.doc.font('Helvetica')
    this.fullWidthText(value)
  }

  private recallOverview(data: RecallCompliancePackData): void {
    this.keyValueRow('Product', data.productName)
    this.keyValueRow('Reason', data.reason)
    this.keyValueRow('Mode', data.mode === 'mock' ? 'Drill (mock)' : 'Real recall')
    this.keyValueRow('Type', data.type ?? '—')
    this.keyValueRow('Level', data.level ?? '—')
    this.keyValueRow('Status', data.status)
    this.keyValueRow('Opened', formatDate(data.openedAt))
    this.keyValueRow('Closed', formatDate(data.closedAt))
  }

  private riskAssessmentSection(data: RecallCompliancePackData): void {
    if (!data.riskAssessment) {
      this.fullWidthText('No hazard/risk evaluation is on record.')
      return
    }
    this.keyValueRow('Title', data.riskAssessment.title)
    this.keyValueRow('Severity', String(data.riskAssessment.severity))
    this.keyValueRow('Probability', String(data.riskAssessment.probability))
    this.keyValueRow('Score', String(data.riskAssessment.score))
    this.keyValueRow('Risk level', data.riskAssessment.riskLevel)
  }

  private scopeSection(data: RecallCompliancePackData): void {
    if (data.scopeItems.length === 0) {
      this.fullWidthText('No scope items recorded.')
      return
    }
    for (const item of data.scopeItems) {
      this.fullWidthText(`Batch ${item.batchId.slice(0, 8)}… — batch size ${item.batchSize ?? 'n/a'}`)
    }
  }

  private countriesSection(data: RecallCompliancePackData): void {
    if (data.countries.length === 0) {
      this.fullWidthText('No country has been added to this recall.')
      return
    }
    for (const c of data.countries) {
      this.fullWidthText(
        `${c.countryName} — status: ${c.status}, class: ${c.class ?? '—'}, level: ${c.level ?? '—'}, rule-set v${c.ruleSetVersion ?? '—'}, regulator decision: ${c.regulatorDecision ?? 'pending'}`,
      )
    }
  }

  private ruleProvenanceSection(data: RecallCompliancePackData): void {
    if (data.rules.length === 0) {
      this.fullWidthText('No country rule-set has resolved any obligation for this recall yet — shown as "per rule-set," never a fabricated deadline.')
      return
    }
    this.doc.fontSize(8).fillColor('#666666')
    this.fullWidthText('Decision support, not legal advice — every rule below cites its own source instrument; verify against the original guideline before relying on it.')
    this.doc.fontSize(10).fillColor('#000000')
    this.doc.moveDown(0.3)
    for (const r of data.rules) {
      this.fullWidthText(
        `[${r.countryName}] ${r.code} (${r.ruleSetStatus}${r.unverified ? ', UNVERIFIED' : ''}): ${r.requirementText} — Source: ${r.sourceDoc}`,
      )
    }
  }

  private timelineSection(data: RecallCompliancePackData): void {
    if (data.transitionHistory.length === 0) {
      this.fullWidthText('No lifecycle transitions recorded yet.')
      return
    }
    for (const t of data.transitionHistory) {
      this.fullWidthText(
        `${t.occurredAt.toISOString()} — ${t.fromStateKey ?? 'start'} -> ${t.toStateKey} (${t.actorName ?? 'system'})`,
      )
    }
  }

  private distributionSection(data: RecallCompliancePackData): void {
    if (data.distribution.length === 0) {
      this.fullWidthText('No distribution recorded.')
      return
    }
    for (const d of data.distribution) {
      this.fullWidthText(`${formatDate(d.date)} — batch ${d.batchNumber} -> ${d.toOrgName}: ${d.qtyUnits} units`)
    }
  }

  private stakeholdersSection(data: RecallCompliancePackData): void {
    if (data.stakeholders.length === 0) {
      this.fullWidthText('No stakeholder recorded.')
      return
    }
    for (const s of data.stakeholders) {
      this.fullWidthText(`${s.orgName} (${s.type}${s.country ? `, ${s.country}` : ''})`)
    }
  }

  private cascadeSection(data: RecallCompliancePackData): void {
    if (data.cascadeInvites.length === 0) {
      this.fullWidthText('No downstream cascade invitations issued.')
      return
    }
    for (const c of data.cascadeInvites) {
      this.fullWidthText(`${c.stakeholderOrgName}: ${c.status}`)
    }
  }

  private messagesSection(data: RecallCompliancePackData): void {
    if (data.messages.length === 0) {
      this.fullWidthText('No messages sent.')
      return
    }
    const byChannel: Record<string, number> = {}
    for (const m of data.messages) byChannel[m.channel] = (byChannel[m.channel] ?? 0) + 1
    for (const [channel, count] of Object.entries(byChannel)) {
      this.fullWidthText(`${channel}: ${count} message(s) sent`)
    }
    if (data.messages.some((m) => m.isDrill)) {
      this.fullWidthText('Note: this recall is a drill — every message sent was visibly marked as such.')
    }
  }

  private quarantineSection(data: RecallCompliancePackData): void {
    if (data.quarantine.length === 0) {
      this.fullWidthText('No stock quarantined.')
      return
    }
    for (const q of data.quarantine) {
      this.fullWidthText(`Batch ${q.batchNumber}: ${q.fullPacks} full pack(s) quarantined`)
    }
  }

  private returnsSection(data: RecallCompliancePackData): void {
    if (data.returns.length === 0) {
      this.fullWidthText('No returns recorded.')
      return
    }
    for (const r of data.returns) {
      this.fullWidthText(`${r.ref}: ${r.qty} unit(s), verdict ${r.verdict ?? 'pending'}, credit ${r.creditStatus}`)
    }
  }

  private reconciliationSection(data: RecallCompliancePackData): void {
    if (data.reconciliation.length === 0) {
      this.fullWidthText('No reconciliation snapshot calculated yet.')
      return
    }
    for (const r of data.reconciliation) {
      const pct = r.distributed > 0 ? ((r.accounted / r.distributed) * 100).toFixed(1) : '0.0'
      this.fullWidthText(
        `${r.countryName} (as of ${formatDate(r.calculatedAt)}): distributed ${r.distributed}, recovered ${r.recovered}, quarantined ${r.quarantined}, accounted ${r.accounted} (${pct}%), outstanding ${r.outstanding}, destroyed ${r.destroyed}`,
      )
    }
  }

  private discrepanciesSection(data: RecallCompliancePackData): void {
    if (data.discrepancies.length === 0) {
      this.fullWidthText('No discrepancy recorded.')
      return
    }
    for (const d of data.discrepancies) {
      this.fullWidthText(`${d.units} unit(s) — ${d.reason} (${d.blocking ? 'blocking' : 'non-blocking'}, ${d.status})`)
    }
  }

  private destructionSection(data: RecallCompliancePackData): void {
    if (data.destruction.length === 0) {
      this.fullWidthText('No destruction recorded.')
      return
    }
    for (const d of data.destruction) {
      this.fullWidthText(`${d.units} unit(s) — ${d.status}`)
    }
  }

  private effectivenessSection(data: RecallCompliancePackData): void {
    if (data.effectivenessChecks.length === 0) {
      this.fullWidthText('No effectiveness check recorded.')
      return
    }
    for (const c of data.effectivenessChecks) {
      this.fullWidthText(`${c.method}: ${c.clear}/${c.sampleSize} clear, ${c.stockFound} stock found (${c.status})`)
    }
  }

  private submissionsSection(data: RecallCompliancePackData): void {
    if (data.submissions.length === 0) {
      this.fullWidthText('No regulator submission generated.')
      return
    }
    for (const s of data.submissions) {
      this.fullWidthText(`${s.countryName} — ${s.templateCode}: ${s.status} (${formatDate(s.generatedAt)})`)
    }
  }

  private capaSection(data: RecallCompliancePackData): void {
    if (!data.investigationCapa) {
      this.fullWidthText('No root-cause CAPA has been opened yet.')
      return
    }
    this.keyValueRow('Title', data.investigationCapa.title)
    this.keyValueRow('Corrective action', data.investigationCapa.correctiveAction)
    this.keyValueRow('Status', data.investigationCapa.status)
  }

  private evidenceSection(data: RecallCompliancePackData): void {
    this.fullWidthText(`${data.evidenceCount} document(s) are on record as evidence for this recall.`)
    this.fullWidthText('Every file is hashed (sha256) on upload and never altered in place — see the Evidence & Audit screen for the full hash-verified register.')
  }

  private annexSection(data: RecallCompliancePackData): void {
    if (data.countries.length === 0) {
      this.fullWidthText('No country annex — no country has been added to this recall.')
      return
    }
    for (const c of data.countries) {
      this.doc.font('Helvetica-Bold')
      this.fullWidthText(c.countryName)
      this.doc.font('Helvetica')
      this.fullWidthText(`Status: ${c.status} · Class: ${c.class ?? '—'} · Rule-set version: ${c.ruleSetVersion ?? '—'}`)
      this.doc.moveDown(0.3)
    }
  }

  private certificationSection(data: RecallCompliancePackData): void {
    this.fullWidthText(
      'This compliance pack is a point-in-time snapshot generated automatically from the SafeMeds QualCloud system of record. It is a decision-support and evidence-organisation aid, not a substitute for the company’s own regulatory judgment or legal advice.',
    )
    this.doc.moveDown(1)
    this.fullWidthText(`Generated: ${data.generatedAt.toISOString()}`)
  }
}
