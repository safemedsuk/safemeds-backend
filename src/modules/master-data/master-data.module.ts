import { BullModule, InjectQueue } from '@nestjs/bullmq'
import { Module, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'

import { EnvConfig } from '../../config/env.validation'
import { AuditModule } from '../audit/audit.module'
import { DocumentsModule } from '../documents/documents.module'
import { RegulatoryModule } from '../regulatory/regulatory.module'
import { SignaturesModule } from '../signatures/signatures.module'
import { TasksModule } from '../tasks/tasks.module'
import { TenancyModule } from '../tenancy/tenancy.module'
import { MasterDataController } from './master-data.controller'
import { MasterDataService } from './master-data.service'
import { MeddraController } from './meddra.controller'
import { MeddraService } from './meddra.service'
import {
  PRODUCT_REVIEW_REMINDER_QUEUE,
  ProductReviewReminderProcessor,
} from './product-review-reminder.processor'
import { ProductReviewReminderService } from './product-review-reminder.service'
import { WhoDrugController } from './who-drug.controller'
import { WhoDrugService } from './who-drug.service'

// Roughly weekly — cheap to scan (one query per active company), and each
// company is only actually reminded once per quarter regardless of how
// often this runs (see `ProductReviewReminderService`'s own doc comment)
// — a coarser interval would just mean a company's reminder lands up to
// a week later than its exact quarterly mark, which doesn't matter here.
const REMINDER_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

@Module({
  imports: [
    AuditModule,
    TasksModule,
    RegulatoryModule,
    TenancyModule,
    DocumentsModule,
    SignaturesModule,
    BullModule.registerQueueAsync({
      name: PRODUCT_REVIEW_REMINDER_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => {
        const url = new URL(configService.get('REDIS_URL', { infer: true }))
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            maxRetriesPerRequest: null,
          },
        }
      },
    }),
  ],
  controllers: [MasterDataController, MeddraController, WhoDrugController],
  providers: [
    MasterDataService,
    MeddraService,
    WhoDrugService,
    ProductReviewReminderService,
    ProductReviewReminderProcessor,
  ],
  exports: [MasterDataService, MeddraService, WhoDrugService],
})
export class MasterDataModule implements OnModuleInit {
  constructor(
    @InjectQueue(PRODUCT_REVIEW_REMINDER_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  /** Skipped in tests — see `WorkflowModule`'s identical guard for why (repeated app-boot in unit/e2e suites shouldn't each schedule a competing repeatable job against a shared Redis). */
  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return
    }
    await this.queue.add(
      'scan',
      {},
      { repeat: { every: REMINDER_SCAN_INTERVAL_MS }, jobId: 'product-review-reminder-weekly' },
    )
  }
}
