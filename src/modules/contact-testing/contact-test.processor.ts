import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from 'nestjs-pino'

import { ContactTestService } from './contact-test.service'

export const CONTACT_TEST_QUEUE = 'contact-test-sweep'

@Processor(CONTACT_TEST_QUEUE)
export class ContactTestProcessor extends WorkerHost {
  constructor(
    private readonly contactTestService: ContactTestService,
    private readonly logger: Logger,
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const result = await this.contactTestService.processDue()
    this.logger.log(
      { result },
      `Contact-test sweep complete: ${result.settled} settled out of ${result.scanned} due`,
    )
  }
}
