import { RegDeadline } from '@prisma/client'

/** RegCloud's own equivalent of `DeadlineEscalationNotifier` — day-scale thresholds instead of hour-scale ones (see `RegDeadlineService`'s own doc comment for why). */
export interface RegDeadlineEscalationNotifier {
  onApproaching(deadline: RegDeadline, threshold: '180d' | '90d' | '30d'): Promise<void>
  onBreach(deadline: RegDeadline): Promise<void>
}

export const REG_DEADLINE_ESCALATION_NOTIFIER = Symbol('REG_DEADLINE_ESCALATION_NOTIFIER')
