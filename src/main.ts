import './common/net/force-ipv4-fetch'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import * as Sentry from '@sentry/node'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { configureApp } from './bootstrap'
import { EnvConfig } from './config/env.validation'

async function bootstrap(): Promise<void> {
  // `rawBody: true` exposes `req.rawBody` (the exact bytes received)
  // alongside the normal parsed JSON body — needed by Stage 3's inbound
  // webhooks (Resend's inbound-email webhook, Meta's WhatsApp webhook),
  // both of which sign the *raw* request body and would silently fail
  // signature verification against a re-serialized JSON.stringify of the
  // parsed body (key order/whitespace aren't guaranteed to round-trip).
  // Every other route is completely unaffected — this only adds the raw
  // buffer, it doesn't change how the body is parsed for existing routes.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })
  const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService)

  app.useLogger(app.get(Logger))
  configureApp(app, configService)

  const sentryDsn = configService.get('SENTRY_DSN', { infer: true })
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment:
        configService.get('SENTRY_ENVIRONMENT', { infer: true }) ??
        configService.get('NODE_ENV', { infer: true }),
      tracesSampleRate: configService.get('SENTRY_TRACES_SAMPLE_RATE', { infer: true }),
    })
  }

  const swaggerEnabled = configService.get('SWAGGER_ENABLED', { infer: true })
  const nodeEnv = configService.get('NODE_ENV', { infer: true })

  if (swaggerEnabled && nodeEnv !== 'production') {
    const swaggerDocumentConfig = new DocumentBuilder()
      .setTitle('SafeMeds API')
      .setDescription('SafeMeds compliance backbone API')
      .setVersion('0.0.1')
      .addCookieAuth('access_token', { type: 'apiKey', in: 'cookie', name: 'access_token' })
      .build()

    const document = SwaggerModule.createDocument(app, swaggerDocumentConfig)
    SwaggerModule.setup(configService.get('SWAGGER_PATH', { infer: true }), app, document)
  }

  await app.listen(configService.get('PORT', { infer: true }))
}

void bootstrap()
