/**
 * QualCloud Phase 1 Pass B (item C1) — the derived "due" status shown on the
 * equipment register for calibration and maintenance. Derived live from the
 * due date, never stored, so it can never be stale.
 *
 * `due_soon` = due within the next 30 days (the same window the other
 * QualCloud reminder scans use). `not_scheduled` = no due date has been set.
 */
export type EquipmentDueStatus = 'not_scheduled' | 'current' | 'due_soon' | 'overdue'

export const EQUIPMENT_DUE_SOON_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function equipmentDueStatus(dueAt: Date | null, now: Date = new Date()): EquipmentDueStatus {
  if (!dueAt) return 'not_scheduled'
  if (dueAt.getTime() < now.getTime()) return 'overdue'
  if (dueAt.getTime() - now.getTime() <= EQUIPMENT_DUE_SOON_DAYS * DAY_MS) return 'due_soon'
  return 'current'
}
