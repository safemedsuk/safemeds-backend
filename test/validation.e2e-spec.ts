import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { IsString, MinLength } from 'class-validator'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApp } from '../src/bootstrap'
import { EnvConfig } from '../src/config/env.validation'
import { httpServer } from './utils/create-test-app'

/**
 * A throwaway DTO/controller mounted only for this spec, so the global
 * ValidationPipe + AllExceptionsFilter error-envelope shape can be proven
 * end-to-end without depending on any real domain endpoint (none exist yet
 * in Phase 0 — the first DTOs land in Phase 1).
 */
class PingDto {
  @IsString()
  @MinLength(3)
  name!: string
}

@Controller('test-validation')
class TestValidationController {
  @Post()
  ping(@Body() dto: PingDto): PingDto {
    return dto
  }
}

@Module({
  imports: [AppModule],
  controllers: [TestValidationController],
})
class TestValidationModule {}

describe('Validation error shape (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestValidationModule],
    }).compile()

    app = moduleRef.createNestApplication()
    const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService)
    configureApp(app, configService)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the error envelope with per-field details on a missing required field', async () => {
    const response = await request(httpServer(app))
      .post('/api/v1/test-validation')
      .send({})
      .expect(400)

    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: expect.arrayContaining([expect.stringContaining('name')]),
      },
    })
  })

  it('rejects unknown fields (forbidNonWhitelisted)', async () => {
    const response = await request(httpServer(app))
      .post('/api/v1/test-validation')
      .send({ name: 'abc', extra: 'not allowed' })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('passes through a valid payload', async () => {
    const response = await request(httpServer(app))
      .post('/api/v1/test-validation')
      .send({ name: 'abc' })
      .expect(201)

    expect(response.body).toEqual({ data: { name: 'abc' } })
  })
})
