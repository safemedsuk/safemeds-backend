import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { EnvConfig } from '../../config/env.validation'
import { AuthModule } from '../auth/auth.module'
import {
  NOTIFICATION_EMAIL_QUEUE,
  NotificationEmailProcessor,
} from './notification-email.processor'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueueAsync({
      name: NOTIFICATION_EMAIL_QUEUE,
      inject: [ConfigService],
      // Same connection-as-options pattern as `WorkflowModule`'s deadline-
      // escalation queue, for the same reason: letting `@nestjs/bullmq`
      // own the connection lifecycle (not passing it a pre-built `Redis`
      // instance) is what makes it close cleanly on shutdown.
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
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEmailProcessor],
  exports: [NotificationsService, BullModule],
})
export class NotificationsModule {}
