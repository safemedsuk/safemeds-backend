import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import * as Sentry from '@sentry/node'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { configureApp } from './bootstrap'
import { EnvConfig } from './config/env.validation'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
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
