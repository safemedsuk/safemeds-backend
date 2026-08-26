import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { RegLicensingExpiryService } from './reg-licensing-expiry.service'

export const REG_LICENSING_EXPIRY_QUEUE = 'reg-licensing-expiry'

/** Daily — a licence/permit renewal cycle moves in months, not hours; matches `RegFeeOverdueProcessor`/`RegDeadlineEscalationProcessor`'s own cadence reasoning. Covers Facility, PersonnelLicence, and ImportExportPermit in one pass. */
@Processor(REG_LICENSING_EXPIRY_QUEUE)
export class RegLicensingExpiryProcessor extends WorkerHost {
  constructor(
    private readonly service: RegLicensingExpiryService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.service.scan()
    this.logger.log(
      result,
      `RegCloud licensing/permit expiry scan complete: ${result.expired} expired, ${result.approaching} approaching-reminder(s) sent`,
    )
  }
}
