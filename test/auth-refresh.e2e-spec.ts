import { INestApplication } from '@nestjs/common'
import { randomUUID } from 'crypto'
import request from 'supertest'

import { TokenService } from '../src/modules/auth/services/token.service'
import { createTestApp, httpServer } from './utils/create-test-app'
import { testPrisma } from './utils/prisma-test-client'

/**
 * Regression coverage for a real, previously-shipped bug: `TokenService
 * .rotate()` read `refresh_token.findUnique({ include: { user: true } })`
 * through a bare, non-RLS-scoped Prisma client. `app_user` has FORCE ROW
 * LEVEL SECURITY, so with no `app.company_id`/`app.bypass_rls` session
 * variable set, the joined `user` row was invisible to the query — and
 * because `user` is a required (non-optional) relation, Prisma didn't
 * silently return null, it threw `PrismaClientUnknownRequestError`. Every
 * single `POST /auth/refresh` call, for every user, 500'd — meaning the
 * frontend's silent 401-refresh-retry flow always failed and users were
 * hard-logged-out the moment their 15-minute access token expired,
 * regardless of how actively they were using the app. `createAuthenticated
 * Actor` (used by every other e2e spec) mints access tokens directly and
 * never exercises this code path at all, which is exactly how this shipped
 * unnoticed — this spec drives the real cookie-based refresh flow instead.
 */
describe('Auth refresh (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function createUserWithRefreshToken() {
    const countryId = randomUUID()
    await testPrisma.country.create({ data: { id: countryId, isoCode: 'KE', name: 'Kenya' } })
    const companyId = randomUUID()
    await testPrisma.company.create({
      data: {
        id: companyId,
        name: 'Refresh Test Co',
        companyType: 'manufacturer',
        homeCountryId: countryId,
        status: 'active',
      },
    })

    const userId = randomUUID()
    await testPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      await tx.user.create({
        data: {
          id: userId,
          companyId,
          email: `refresh-e2e-${userId}@safemeds.test`,
          fullName: 'Refresh E2E User',
          passwordHash: 'unused-in-e2e',
          status: 'active',
          roleKeys: ['SYSTEM_ADMINISTRATOR'],
        },
      })
    })

    const tokenService = app.get(TokenService)
    const issued = await tokenService.issueRefreshTokenFamily(userId, {})

    return { userId, plaintextRefreshToken: issued.plaintext }
  }

  it('POST /api/v1/auth/refresh succeeds and returns the fresh user under real RLS (not a 500)', async () => {
    const { userId, plaintextRefreshToken } = await createUserWithRefreshToken()

    const response = await request(httpServer(app))
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${plaintextRefreshToken}`)
      .expect(201)

    expect(response.body.data.user.id).toBe(userId)
    // A fresh access + refresh token pair, and a fresh CSRF cookie, must all be reissued.
    const setCookies = response.headers['set-cookie'] as unknown as string[]
    expect(setCookies.some((c) => c.startsWith('access_token='))).toBe(true)
    expect(setCookies.some((c) => c.startsWith('refresh_token='))).toBe(true)
    expect(setCookies.some((c) => c.startsWith('csrf='))).toBe(true)
  })

  it('rotation actually rotates: the old refresh token cannot be reused after a refresh', async () => {
    const { plaintextRefreshToken } = await createUserWithRefreshToken()

    await request(httpServer(app))
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${plaintextRefreshToken}`)
      .expect(201)

    await request(httpServer(app))
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${plaintextRefreshToken}`)
      .expect(401)
  })

  it('rejects a refresh with no cookie at all', async () => {
    await request(httpServer(app)).post('/api/v1/auth/refresh').expect(401)
  })
})
