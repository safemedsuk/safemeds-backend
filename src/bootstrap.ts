import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import { requestIdMiddleware } from './common/middleware/request-id.middleware'
import { EnvConfig } from './config/env.validation'

/**
 * Applies everything that operates on the live `INestApplication` instance
 * (as opposed to module-graph providers like the global pipe/filter/
 * interceptor, which live in AppModule). Shared between `main.ts` and the
 * e2e test bootstrap so tests exercise the exact same request pipeline as
 * production.
 */
export function configureApp(
  app: INestApplication,
  configService: ConfigService<EnvConfig, true>,
): void {
  app.use(requestIdMiddleware)
  app.use(helmet())
  app.use(cookieParser())

  const additionalOrigins = configService.get('CORS_ADDITIONAL_ORIGINS', { infer: true }) ?? []

  app.enableCors({
    origin: [configService.get('FRONTEND_URL', { infer: true }), ...additionalOrigins],
    credentials: true,
  })

  app.setGlobalPrefix(configService.get('API_PREFIX', { infer: true }))
  app.enableShutdownHooks()
}
