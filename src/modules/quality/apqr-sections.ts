import { Prisma } from '@prisma/client'

/**
 * Phase 2 Pass C — the APQR's full cross-module snapshot. Every section is
 * pulled once, inside the assembly transaction, and frozen onto the row as
 * ISO strings. Rendering (PDF, Excel) reads only this snapshot, so a re-
 * download or a re-render can never drift from what was signed.
 *
 * Scope honesty: the schema has no equipment-to-product link, no
 * environmental-monitoring-to-product link, and no training-to-product link.
 * Those sections are therefore company-wide for the period and are labelled
 * as such in the document; they are never presented as product-specific.
 */

export interface ApqrSnapshot {
  periodStart: string
  periodEnd: string
  batches: {
    id: string
    batchNumber: string
    manufacturedOn: string
    expiresOn: string
    qualityStatus: string
    releaseDecision: string | null
    releasedAt: string | null
  }[]
  deviations: {
    id: string
    ref: string
    title: string
    detectedAt: string
    status: string
    severity: string | null
    closedAt: string | null
  }[]
  capas: {
    id: string
    title: string
    source: string
    status: string
    ownerName: string | null
    dueDate: string | null
    createdAt: string
    closedAt: string | null
  }[]
  oos: {
    id: string
    ref: string
    batchNumber: string
    phase: string
    createdAt: string
    closedAt: string | null
  }[]
  complaints: {
    id: string
    ref: string
    receivedAt: string
    classification: string | null
    status: string
  }[]
  changeControls: { id: string; ref: string; status: string; createdAt: string }[]
  recalls: { id: string; ref: string; status: string; openedAt: string }[]
  returns: {
    id: string
    ref: string
    recallRef: string
    batchNumber: string | null
    qty: number
    verdict: string | null
    recordedAt: string
  }[]
  stability: {
    studyId: string
    storageCondition: string
    timepointMonths: number
    pullDate: string | null
    status: string
    withinSpec: boolean | null
  }[]
  environmental: {
    id: string
    sampledAt: string
    facilityName: string
    cleanroomGrade: string
    result: string
    excursionLevel: string | null
  }[]
  equipment: { equipmentName: string; stage: string; result: string; performedAt: string }[]
  training: { totalRecords: number; expired: number; expiringWithin30Days: number; asOf: string }
  suppliers: {
    supplierId: string
    name: string
    criticality: string
    approvalStatus: string
    nextRequalificationDueAt: string | null
  }[]
  regulatory: { kind: 'submission' | 'variation'; ref: string; status: string; createdAt: string }[]
}

const DAY_MS = 24 * 60 * 60 * 1000

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** UTC calendar-year default period, end-inclusive (`periodEnd` is a calendar date). */
export function defaultApqrPeriod(now: Date): { start: Date; end: Date } {
  const year = now.getUTCFullYear()
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) }
}

export async function collectApqrSnapshot(
  tx: Prisma.TransactionClient,
  companyId: string,
  productId: string,
  periodStart: Date,
  periodEnd: Date,
  now: Date,
): Promise<ApqrSnapshot> {
  // Timestamptz fields: [start 00:00, end + 1 day) so the whole last day is included.
  const endExclusive = new Date(periodEnd.getTime() + DAY_MS)
  const ts = { gte: periodStart, lt: endExclusive }
  const dateRange = { gte: periodStart, lte: periodEnd }

  const [
    batches,
    deviations,
    complaints,
    changeControls,
    oosRows,
    recalls,
    returns,
    studies,
    timepoints,
    environmental,
    equipmentEvents,
    trainingRecords,
    specifications,
    submissions,
    variations,
  ] = await Promise.all([
    tx.batch.findMany({
      where: { companyId, productId, manufacturedOn: dateRange },
      include: { batchReleaseDecisions: { orderBy: { releasedAt: 'desc' }, take: 1 } },
      orderBy: { manufacturedOn: 'asc' },
    }),
    tx.deviation.findMany({
      where: { companyId, productId, detectedAt: ts },
      orderBy: { detectedAt: 'asc' },
    }),
    tx.complaint.findMany({
      where: { companyId, productId, createdAt: ts },
      orderBy: { createdAt: 'asc' },
    }),
    tx.changeControl.findMany({
      where: { companyId, productId, createdAt: ts },
      orderBy: { createdAt: 'asc' },
    }),
    tx.oos.findMany({
      where: { companyId, batch: { productId }, createdAt: ts },
      include: { batch: { select: { batchNumber: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    tx.recall.findMany({
      where: { companyId, productId, createdAt: ts },
      orderBy: { createdAt: 'asc' },
    }),
    tx.recallReturnRecord.findMany({
      where: { companyId, recall: { productId }, createdAt: ts },
      include: { recall: { select: { ref: true } }, batch: { select: { batchNumber: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    tx.stabilityStudy.findMany({
      where: { companyId, productId },
      select: { id: true, storageCondition: true },
    }),
    tx.stabilityTimepoint.findMany({
      where: { stabilityStudy: { companyId, productId }, pullDate: dateRange },
      orderBy: { pullDate: 'asc' },
    }),
    tx.environmentalMonitoringResult.findMany({
      where: { companyId, sampledAt: ts },
      include: { facility: { select: { name: true } } },
      orderBy: { sampledAt: 'asc' },
    }),
    tx.equipmentQualificationEvent.findMany({
      where: { companyId, performedAt: ts },
      include: { equipment: { select: { name: true } } },
      orderBy: { performedAt: 'asc' },
    }),
    tx.trainingRecord.findMany({ where: { companyId }, select: { expiryDate: true } }),
    tx.specification.findMany({
      where: { companyId, productId, supplierId: { not: null } },
      include: { supplier: true },
    }),
    tx.regSubmission.findMany({
      where: { companyId, createdAt: ts, regDossier: { productId } },
      orderBy: { createdAt: 'asc' },
    }),
    tx.regVariation.findMany({
      where: { companyId, createdAt: ts, regDossier: { productId } },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // CAPAs: every CAPA raised against this product's quality events, opened in
  // the period OR still not closed at assembly time (an open CAPA from an
  // earlier period is still a live obligation for this review).
  const allDeviationIds = (
    await tx.deviation.findMany({ where: { companyId, productId }, select: { id: true } })
  ).map((d) => d.id)
  const allComplaintIds = (
    await tx.complaint.findMany({ where: { companyId, productId }, select: { id: true } })
  ).map((d) => d.id)
  const allOosIds = (
    await tx.oos.findMany({ where: { companyId, batch: { productId } }, select: { id: true } })
  ).map((d) => d.id)
  const allChangeIds = (
    await tx.changeControl.findMany({ where: { companyId, productId }, select: { id: true } })
  ).map((d) => d.id)
  const sourceIds = [...allDeviationIds, ...allComplaintIds, ...allOosIds, ...allChangeIds]
  const capaRows = sourceIds.length
    ? await tx.capa.findMany({
        where: {
          companyId,
          sourceRecordId: { in: sourceIds },
          OR: [{ createdAt: ts }, { NOT: { status: 'closed' } }],
        },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const ownerIds = [
    ...new Set(capaRows.map((c) => c.ownerUserId).filter((x): x is string => Boolean(x))),
  ]
  const owners = ownerIds.length
    ? await tx.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, fullName: true },
      })
    : []
  const ownerName = new Map(owners.map((u) => [u.id, u.fullName]))
  const sourceLabel = (id: string | null) => {
    if (!id) return ''
    if (allDeviationIds.includes(id)) return 'Deviation'
    if (allComplaintIds.includes(id)) return 'Complaint'
    if (allOosIds.includes(id)) return 'OOS'
    if (allChangeIds.includes(id)) return 'Change control'
    return 'Other'
  }

  const timepointStudyIds = new Map(studies.map((s) => [s.id, s.storageCondition]))

  // Training is company-wide: the schema does not link a training record to a product.
  const expired = trainingRecords.filter((t) => t.expiryDate && t.expiryDate < now).length
  const expiringWithin30Days = trainingRecords.filter(
    (t) =>
      t.expiryDate && t.expiryDate >= now && t.expiryDate.getTime() <= now.getTime() + 30 * DAY_MS,
  ).length

  const supplierById = new Map<string, NonNullable<(typeof specifications)[number]['supplier']>>()
  for (const spec of specifications) {
    if (spec.supplier) supplierById.set(spec.supplier.id, spec.supplier)
  }

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    batches: batches.map((b) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      manufacturedOn: b.manufacturedOn.toISOString(),
      expiresOn: b.expiresOn.toISOString(),
      qualityStatus: b.qualityStatus,
      releaseDecision: b.batchReleaseDecisions[0]?.decision ?? null,
      releasedAt: iso(b.batchReleaseDecisions[0]?.releasedAt),
    })),
    deviations: deviations.map((d) => ({
      id: d.id,
      ref: d.deviationNumber,
      title: d.title,
      detectedAt: d.detectedAt.toISOString(),
      status: d.status,
      severity: d.severity ?? null,
      closedAt: iso(d.closedAt),
    })),
    capas: capaRows.map((c) => ({
      id: c.id,
      title: c.title,
      source: sourceLabel(c.sourceRecordId),
      status: String(c.status),
      ownerName: c.ownerUserId ? (ownerName.get(c.ownerUserId) ?? null) : null,
      dueDate: iso(c.dueDate),
      createdAt: c.createdAt.toISOString(),
      closedAt: iso(c.closedAt),
    })),
    oos: oosRows.map((o) => ({
      id: o.id,
      ref: o.oosNumber,
      batchNumber: o.batch.batchNumber,
      phase: o.status,
      createdAt: o.createdAt.toISOString(),
      closedAt: iso(o.closedAt),
    })),
    complaints: complaints.map((c) => ({
      id: c.id,
      ref: c.complaintNumber,
      receivedAt: c.createdAt.toISOString(),
      classification: c.classification ?? null,
      status: c.status,
    })),
    changeControls: changeControls.map((c) => ({
      id: c.id,
      ref: c.changeNumber,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
    })),
    recalls: recalls.map((r) => ({
      id: r.id,
      ref: r.ref ?? r.id,
      status: r.status,
      openedAt: r.createdAt.toISOString(),
    })),
    returns: returns.map((r) => ({
      id: r.id,
      ref: r.ref,
      recallRef: r.recall.ref ?? '',
      batchNumber: r.batch?.batchNumber ?? null,
      qty: r.qty,
      verdict: r.verdict ?? null,
      recordedAt: r.createdAt.toISOString(),
    })),
    stability: timepoints.map((t) => ({
      studyId: t.stabilityStudyId,
      storageCondition: timepointStudyIds.get(t.stabilityStudyId) ?? '',
      timepointMonths: t.timepointMonths,
      pullDate: iso(t.pullDate),
      status: t.status,
      withinSpec: t.withinSpec ?? null,
    })),
    environmental: environmental.map((e) => ({
      id: e.id,
      sampledAt: e.sampledAt.toISOString(),
      facilityName: e.facility.name,
      cleanroomGrade: e.cleanroomGrade,
      result: e.result,
      excursionLevel: e.excursionLevel ?? null,
    })),
    equipment: equipmentEvents.map((e) => ({
      equipmentName: e.equipment.name,
      stage: e.stage,
      result: e.result,
      performedAt: e.performedAt.toISOString(),
    })),
    training: {
      totalRecords: trainingRecords.length,
      expired,
      expiringWithin30Days,
      asOf: now.toISOString(),
    },
    suppliers: [...supplierById.values()].map((s) => ({
      supplierId: s.id,
      name: s.name,
      criticality: s.criticality,
      approvalStatus: s.approvalStatus,
      nextRequalificationDueAt: iso(s.nextRequalificationDueAt),
    })),
    regulatory: [
      ...submissions.map((s) => ({
        kind: 'submission' as const,
        ref: `Submission ${s.submissionNumber} (${s.channel})`,
        status: s.dispatchedAt ? 'dispatched' : 'generated, not dispatched',
        createdAt: s.createdAt.toISOString(),
      })),
      ...variations.map((v) => ({
        kind: 'variation' as const,
        ref: v.displayCode,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      })),
    ],
  }
}
