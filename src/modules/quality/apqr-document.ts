import type { ApqrSnapshot } from './apqr-sections'

/**
 * Phase 2 Pass C — the APQR document model. One pure function turns the
 * frozen snapshot into titled tables, so the PDF and the Excel workbook
 * can never disagree about what a section contains.
 */

export interface ApqrColumn {
  label: string
  /** Relative width in PDF points; the set of columns in a table sums to 495. */
  width: number
}

export interface ApqrTable {
  /** Short heading, also the Excel sheet name (trimmed to 31 characters). */
  title: string
  /** Plain-language scope note shown under the heading. */
  scopeNote: string | null
  columns: ApqrColumn[]
  rows: string[][]
  emptyText: string
}

export interface ApqrHeader {
  companyName: string
  productName: string
  periodStart: string
  periodEnd: string
  /** Shown verbatim; states the timezone the default period was computed in. */
  periodNote: string
  generatedAt: string
  reviewedByFullName: string | null
  reviewedAt: string | null
  conclusionsNarrative: string | null
  trendsNarrative: string | null
  recommendedActions: { description: string; capaOpened: boolean }[]
  stabilityNote: string
  openQualityTrendFlags: string[]
}

export interface ApqrDocumentModel {
  header: ApqrHeader
  summary: { label: string; value: string }[]
  tables: ApqrTable[]
}

export const APQR_TIMEZONE_NOTE =
  'Default period: 1 January to 31 December of the current year, computed in UTC (the company has no timezone setting). Each event is counted on the calendar day of its UTC timestamp.'

function day(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

function stamp(value: string | null): string {
  return value ? `${value.slice(0, 10)} ${value.slice(11, 16)} UTC` : ''
}

function yesNo(value: boolean | null): string {
  if (value === null) return 'not recorded'
  return value ? 'within specification' : 'OUT of specification'
}

export function buildApqrDocument(snapshot: ApqrSnapshot, header: ApqrHeader): ApqrDocumentModel {
  const released = snapshot.batches.filter((b) => b.releaseDecision === 'released').length
  const rejected = snapshot.batches.filter(
    (b) => b.releaseDecision === 'rejected' || b.qualityStatus === 'rejected',
  ).length
  const openCapas = snapshot.capas.filter((c) => c.status !== 'closed').length

  const summary = [
    { label: 'Batches manufactured', value: String(snapshot.batches.length) },
    { label: 'Batches released', value: String(released) },
    { label: 'Batches rejected', value: String(rejected) },
    { label: 'Deviations', value: String(snapshot.deviations.length) },
    {
      label: 'CAPAs (in period or still open)',
      value: `${snapshot.capas.length} (${openCapas} not closed)`,
    },
    { label: 'OOS / OOT investigations', value: String(snapshot.oos.length) },
    { label: 'Complaints', value: String(snapshot.complaints.length) },
    { label: 'Change controls', value: String(snapshot.changeControls.length) },
    { label: 'Recalls', value: String(snapshot.recalls.length) },
    { label: 'Returns', value: String(snapshot.returns.length) },
    { label: 'Stability', value: header.stabilityNote },
    {
      label: 'Open quality trend flags',
      value: header.openQualityTrendFlags.length ? header.openQualityTrendFlags.join('; ') : 'none',
    },
  ]

  const tables: ApqrTable[] = [
    {
      title: '1. Batches',
      scopeNote: 'Batches for this product manufactured in the period.',
      columns: [
        { label: 'Batch', width: 90 },
        { label: 'Manufactured', width: 70 },
        { label: 'Expires', width: 70 },
        { label: 'Quality status', width: 80 },
        { label: 'Release decision', width: 90 },
        { label: 'Decided at', width: 95 },
      ],
      rows: snapshot.batches.map((b) => [
        b.batchNumber,
        day(b.manufacturedOn),
        day(b.expiresOn),
        b.qualityStatus,
        b.releaseDecision ?? 'not decided',
        stamp(b.releasedAt),
      ]),
      emptyText: 'No batches manufactured in this period.',
    },
    {
      title: '2. Deviations',
      scopeNote: null,
      columns: [
        { label: 'Reference', width: 80 },
        { label: 'Title', width: 150 },
        { label: 'Detected', width: 70 },
        { label: 'Status', width: 75 },
        { label: 'Severity', width: 45 },
        { label: 'Closed', width: 75 },
      ],
      rows: snapshot.deviations.map((d) => [
        d.ref,
        d.title,
        day(d.detectedAt),
        d.status,
        d.severity ?? '',
        stamp(d.closedAt),
      ]),
      emptyText: 'No deviations detected in this period.',
    },
    {
      title: '3. CAPAs',
      scopeNote:
        'CAPAs raised against this product’s deviations, complaints, OOS investigations or change controls, opened in the period or not yet closed.',
      columns: [
        { label: 'Title', width: 150 },
        { label: 'Source', width: 70 },
        { label: 'Status', width: 65 },
        { label: 'Owner', width: 90 },
        { label: 'Due', width: 60 },
        { label: 'Closed', width: 60 },
      ],
      rows: snapshot.capas.map((c) => [
        c.title,
        c.source,
        c.status,
        c.ownerName ?? 'unassigned',
        day(c.dueDate),
        day(c.closedAt),
      ]),
      emptyText: 'No CAPAs in this period or still open.',
    },
    {
      title: '4. OOS and OOT',
      scopeNote:
        'The OOS register does not separately tag OOT results; both are recorded as investigations here.',
      columns: [
        { label: 'Reference', width: 95 },
        { label: 'Batch', width: 90 },
        { label: 'Investigation phase', width: 150 },
        { label: 'Opened', width: 80 },
        { label: 'Closed', width: 80 },
      ],
      rows: snapshot.oos.map((o) => [
        o.ref,
        o.batchNumber,
        o.phase,
        day(o.createdAt),
        day(o.closedAt),
      ]),
      emptyText: 'No OOS or OOT investigations in this period.',
    },
    {
      title: '5. Complaints',
      scopeNote: null,
      columns: [
        { label: 'Reference', width: 110 },
        { label: 'Received', width: 90 },
        { label: 'Classification', width: 165 },
        { label: 'Status', width: 130 },
      ],
      rows: snapshot.complaints.map((c) => [
        c.ref,
        day(c.receivedAt),
        c.classification ?? 'not classified',
        c.status,
      ]),
      emptyText: 'No complaints received in this period.',
    },
    {
      title: '6. Change controls',
      scopeNote: null,
      columns: [
        { label: 'Reference', width: 200 },
        { label: 'Status', width: 150 },
        { label: 'Raised', width: 145 },
      ],
      rows: snapshot.changeControls.map((c) => [c.ref, c.status, day(c.createdAt)]),
      emptyText: 'No change controls raised in this period.',
    },
    {
      title: '7. Recalls',
      scopeNote: null,
      columns: [
        { label: 'Reference', width: 150 },
        { label: 'Status', width: 170 },
        { label: 'Opened', width: 175 },
      ],
      rows: snapshot.recalls.map((r) => [r.ref, r.status, day(r.openedAt)]),
      emptyText: 'No recalls opened in this period.',
    },
    {
      title: '8. Returns',
      scopeNote: 'Returned stock recorded against this product’s recalls.',
      columns: [
        { label: 'Reference', width: 80 },
        { label: 'Recall', width: 80 },
        { label: 'Batch', width: 85 },
        { label: 'Qty', width: 40 },
        { label: 'Verdict', width: 110 },
        { label: 'Recorded', width: 100 },
      ],
      rows: snapshot.returns.map((r) => [
        r.ref,
        r.recallRef,
        r.batchNumber ?? '',
        String(r.qty),
        r.verdict ?? 'pending',
        stamp(r.recordedAt),
      ]),
      emptyText: 'No returns recorded in this period.',
    },
    {
      title: '9. Stability',
      scopeNote: 'Stability timepoints for this product pulled in the period.',
      columns: [
        { label: 'Storage condition', width: 130 },
        { label: 'Timepoint (months)', width: 70 },
        { label: 'Pull date', width: 90 },
        { label: 'Status', width: 110 },
        { label: 'Result', width: 95 },
      ],
      rows: snapshot.stability.map((t) => [
        t.storageCondition,
        String(t.timepointMonths),
        day(t.pullDate),
        t.status,
        yesNo(t.withinSpec),
      ]),
      emptyText: 'No stability timepoints pulled in this period.',
    },
    {
      title: '10. Environmental monitoring',
      scopeNote:
        'Company-wide for the period. The monitoring register is not linked to products, so these results are not product-specific.',
      columns: [
        { label: 'Sampled', width: 90 },
        { label: 'Facility', width: 150 },
        { label: 'Grade', width: 60 },
        { label: 'Result', width: 80 },
        { label: 'Excursion', width: 115 },
      ],
      rows: snapshot.environmental.map((e) => [
        stamp(e.sampledAt),
        e.facilityName,
        e.cleanroomGrade,
        e.result,
        e.excursionLevel ?? 'none',
      ]),
      emptyText: 'No environmental monitoring results in this period.',
    },
    {
      title: '11. Equipment and calibration',
      scopeNote:
        'Company-wide for the period. Equipment is not linked to products in the register, so these events are not product-specific.',
      columns: [
        { label: 'Equipment', width: 160 },
        { label: 'Stage', width: 70 },
        { label: 'Result', width: 80 },
        { label: 'Performed', width: 185 },
      ],
      rows: snapshot.equipment.map((e) => [
        e.equipmentName,
        e.stage,
        e.result,
        stamp(e.performedAt),
      ]),
      emptyText: 'No equipment qualification events in this period.',
    },
    {
      title: '12. Training',
      scopeNote: `Company-wide, as of ${stamp(snapshot.training.asOf)}. Training is not linked to products in the register.`,
      columns: [
        { label: 'Measure', width: 300 },
        { label: 'Value', width: 195 },
      ],
      rows: [
        ['Training records on file', String(snapshot.training.totalRecords)],
        ['Expired at assembly', String(snapshot.training.expired)],
        ['Expiring within 30 days', String(snapshot.training.expiringWithin30Days)],
      ],
      emptyText: 'No training records on file.',
    },
    {
      title: '13. Suppliers of critical materials',
      scopeNote: 'Suppliers named on this product’s specifications.',
      columns: [
        { label: 'Supplier', width: 180 },
        { label: 'Criticality', width: 100 },
        { label: 'Approval', width: 115 },
        { label: 'Next requalification', width: 100 },
      ],
      rows: snapshot.suppliers.map((s) => [
        s.name,
        s.criticality,
        s.approvalStatus,
        day(s.nextRequalificationDueAt),
      ]),
      emptyText: 'No suppliers linked to this product’s specifications.',
    },
    {
      title: '14. Regulatory',
      scopeNote: 'Submissions and variations for this product raised in the period.',
      columns: [
        { label: 'Item', width: 160 },
        { label: 'Status', width: 200 },
        { label: 'Raised', width: 135 },
      ],
      rows: snapshot.regulatory.map((r) => [r.ref, r.status, day(r.createdAt)]),
      emptyText: 'No regulatory submissions or variations in this period.',
    },
  ]

  return { header, summary, tables }
}
