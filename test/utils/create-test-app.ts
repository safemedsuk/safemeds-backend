import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
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
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

  const app = moduleRef.createNestApplication()
  const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService)

  configureApp(app, configService)
  await app.init()

  return app
}
