import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModuleBuilder } from '@nestjs/testing'
import type { Server } from 'http'

import { AppModule } from '../../src/app.module'
import { configureApp } from '../../src/bootstrap'
import { EnvConfig } from '../../src/config/env.validation'

/** supertest's `request()` wants a concrete `Server`; `getHttpServer()` is typed `any`. */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server
}

/**
 * Boots the real AppModule with the exact same request pipeline as
 * production (`configureApp`) so e2e specs exercise real middleware,
 * pipes, filters, and interceptors — not a stand-in.
 *
 * `configureTestModule` is an escape hatch for the rare provider that
 * genuinely can't run against `.env.test` as-is — e.g. `StorageService`,
 * whose `R2_ENDPOINT` there is a deliberate placeholder
 * (`dev-placeholder.r2.cloudflarestorage.com`, not a real R2 account),
 * so e2e specs never upload real objects to a real bucket just by
 * running the suite. Most specs don't need this at all (most providers —
 * `MailService` included — are already designed to degrade gracefully
 * against placeholder config, per the "email must be best-effort" rule);
 * reach for it only when a provider would otherwise throw against
 * `.env.test`'s intentionally-fake external credentials.
 */
export async function createTestApp(
  configureTestModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
  if (configureTestModule) {
    builder = configureTestModule(builder)
  }
  const moduleRef = await builder.compile()

  // `rawBody: true` — see `main.ts`'s identical option for why (Stage 3's
  // webhook signature verification needs the exact raw bytes, not a
  // re-serialized parsed body); e2e specs exercise the same real pipeline.
  const app = moduleRef.createNestApplication({ rawBody: true })
  const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService)

  configureApp(app, configService)
  await app.init()

  return app
}
