import { Deadline } from '@prisma/client'

/**
 * The "create escalating tasks + notifications" half of 5.3's spec text —
 * Phase 9 (Task Inbox & Notifications) doesn't exist yet in this codebase,
 * so there is nothing real to create a `Task`/`Notification` row against.
 * Rather than build fake Task/Notification tables prematurely, escalation
 * detection (the actual deadline-tracking logic: who's approaching, who's
 * breached, DB state updates, audit trail) is fully implemented in
 * `DeadlineService.scanAndEscalate()`; only the "now go tell someone" step
 * is behind this interface, with `LoggingDeadlineEscalationNotifier` as the
 * default, log-only implementation. Phase 9 implements this interface for
 * real (create the role/user task, queue the notification) and swaps the
 * `DEADLINE_ESCALATION_NOTIFIER` provider — no change needed to
 * `DeadlineService` itself.
 */
export interface DeadlineEscalationNotifier {
  onApproaching(deadline: Deadline, threshold: '72h' | '24h'): Promise<void>
  onBreach(deadline: Deadline): Promise<void>
}

export const DEADLINE_ESCALATION_NOTIFIER = Symbol('DEADLINE_ESCALATION_NOTIFIER')
