import { Recall, RecallCountry } from '@prisma/client'

/**
 * QualCloud (Phase 13) Stage 10.1 — resolves a `RecallRule.anchorEvent`
 * string to a real timestamp on this specific recall/country pair.
 * Only three anchor events are actually resolvable against what this
 * schema tracks today — any other value (a rule-set author is free to
 * name a company-extensible anchor per 10.1's own "plain,
 * company-extensible string" design) honestly returns `null`, which
 * `RecallRequirementEvaluationService` turns into `status:
 * 'deadline_pending'` plus a real `Task`, never a silently-wrong date.
 *
 * - `trigger_received` — the moment the recall itself was opened
 *   (`Recall.openedAt`).
 * - `recall_decision` — this schema has no separately-tracked "the
 *   moment QA decided to recall" timestamp distinct from when the
 *   `Recall` row itself was opened, so `openedAt` is the closest honest
 *   proxy (documented here rather than silently assumed correct).
 * - `regulator_approval_of_recall` — `RecallCountry.regulatorApprovalAt`,
 *   null until a regulator actually approves for that specific country.
 */
export function resolveRecallAnchorTimestamp(
  anchorEvent: string,
  recall: Pick<Recall, 'openedAt'>,
  recallCountry: Pick<RecallCountry, 'regulatorApprovalAt'>,
): Date | null {
  switch (anchorEvent) {
    case 'trigger_received':
    case 'recall_decision':
      return recall.openedAt ?? null
    case 'regulator_approval_of_recall':
      return recallCountry.regulatorApprovalAt ?? null
    default:
      return null
  }
}

/** `dueAt = anchorEventTimestamp + offset` in the rule's own day basis. Both bases add calendar days — this schema has no working-day-calendar concept anywhere yet, matching `ReportingRule`'s own honest limitation for its `dayType` field. */
export function computeDueAt(anchorTimestamp: Date, offsetDays: number): Date {
  const due = new Date(anchorTimestamp)
  due.setUTCDate(due.getUTCDate() + offsetDays)
  return due
}
