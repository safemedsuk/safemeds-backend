import { Injectable, Logger } from '@nestjs/common'
import { Deadline } from '@prisma/client'

import { DeadlineEscalationNotifier } from './deadline-escalation.interface'

@Injectable()
export class LoggingDeadlineEscalationNotifier implements DeadlineEscalationNotifier {
  private readonly logger = new Logger(LoggingDeadlineEscalationNotifier.name)

  onApproaching(deadline: Deadline, threshold: '72h' | '24h'): Promise<void> {
    this.logger.warn(
      `Deadline approaching (${threshold}): ${deadline.recordType}/${deadline.recordId} due ${deadline.dueAt.toISOString()} (deadline ${deadline.id})`,
    )
    return Promise.resolve()
  }

  onBreach(deadline: Deadline): Promise<void> {
    this.logger.error(
      `Deadline BREACHED: ${deadline.recordType}/${deadline.recordId} was due ${deadline.dueAt.toISOString()} (deadline ${deadline.id})`,
    )
    return Promise.resolve()
  }
}
