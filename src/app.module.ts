import { Module, ValidationPipe } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import type { IncomingMessage } from 'http'
import { LoggerModule } from 'nestjs-pino'

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { RequestWithId } from './common/middleware/request-id.middleware'
import { EnvConfig, validateEnv } from './config/env.validation'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        pinoHttp: {
          level: configService.get('LOG_LEVEL', { infer: true }),
          genReqId: (req: IncomingMessage) => (req as RequestWithId).id ?? '',
          customProps: (req: IncomingMessage) => ({ requestId: (req as RequestWithId).id }),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            remove: true,
          },
          transport:
            configService.get('NODE_ENV', { infer: true }) !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvConfig, true>) => ({
        throttlers: [
          {
            ttl: configService.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: configService.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
