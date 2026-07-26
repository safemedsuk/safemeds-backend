import { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { createTestApp, httpServer } from './utils/create-test-app'

describe('Health (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/v1/health returns liveness status', async () => {
    const response = await request(httpServer(app)).get('/api/v1/health').expect(200)

    expect(response.body).toEqual({
      data: {
        status: 'ok',
        timestamp: expect.any(String),
      },
    })
  })

  it('GET /api/v1/health/ready reports Postgres and Redis as up', async () => {
    const response = await request(httpServer(app)).get('/api/v1/health/ready').expect(200)

    expect(response.body.data.status).toBe('ok')
    expect(response.body.data.details.database.status).toBe('up')
    expect(response.body.data.details.redis.status).toBe('up')
  })

  it('sets X-Request-Id on every response', async () => {
    const response = await request(httpServer(app)).get('/api/v1/health').expect(200)

    expect(response.headers['x-request-id']).toEqual(expect.any(String))
  })
})
