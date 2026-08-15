import { Injectable, Logger } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'

export interface AnomalousAccessFlag {
  actorUserId?: string
  reason: string
  details?: Record<string, unknown>
}

/**
 * VigiCloud Stage 0.2 — "a documented, wired alerting hook (not full
 * SIEM)". Deliberately small: a real, callable, audited signal path for
 * a future caller (e.g. a repeated-404 pattern from the tenant-isolation
 * 404-not-403 behaviour, or a future rate-limited endpoint) to flag
 * something worth a platform admin's attention — not a detection engine
 * itself. Reuses the exact same `platform_access`-style audit pattern
 * `RlsService.runWithPlatformAccess` already established for cross-tenant
 * reads, so anomaly flags land in the same auditable trail platform
 * staff already review.
 */
@Injectable()
export class BreachDetectionService {
  private readonly logger = new Logger(BreachDetectionService.name)

  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
  ) {}

  async flagAnomalousAccess(flag: AnomalousAccessFlag): Promise<void> {
    this.logger.warn({ msg: 'Anomalous access flagged', ...flag })

    await this.rls.runWithSystemAccess((tx) =>
      this.auditService.log(tx, {
        actorUserId: flag.actorUserId ?? null,
        actorType: 'system',
        action: 'anomalous_access_flagged',
        recordType: 'system',
        newValue: { reason: flag.reason, ...flag.details },
      }),
    )
  }
}
