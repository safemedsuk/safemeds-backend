import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { ContactTestController } from './contact-test.controller'
import { CONTACT_TEST_QUEUE, ContactTestProcessor } from './contact-test.processor'
import { ContactTestService } from './contact-test.service'

const DAILY_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000

function redisConnectionFactory(configService: ConfigService<EnvConfig, true>) {
  const url = new URL(configService.get('REDIS_URL', { infer: true }))
  return {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    },
  }
}

@Module({
  imports: [
    AuditModule,
    NotificationsModule,
    BullModule.registerQueueAsync({
      name: CONTACT_TEST_QUEUE,
      inject: [ConfigService],
      useFactory: redisConnectionFactory,
    }),
  ],
  controllers: [ContactTestController],
  providers: [ContactTestService, ContactTestProcessor],
  exports: [ContactTestService],
})
export class ContactTestingModule implements OnModuleInit {
  constructor(
    @InjectQueue(CONTACT_TEST_QUEUE) private readonly contactTestQueue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `PvModule`/`MasterDataModule`'s identical guard for why. */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    // Daily, matching Stage 10/11's own periodic jobs — an email test's
    // window is measured in whole calendar days, so a coarser scan
    // cadence than that never materially delays detecting a timeout.
    await this.contactTestQueue.add(
      'sweep',
      {},
      { repeat: { every: DAILY_SCAN_INTERVAL_MS }, jobId: 'contact-test-daily-sweep' },
    )
  }
}
