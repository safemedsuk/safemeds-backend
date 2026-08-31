import { INestApplication } from '@nestjs/common'
import { PlatformRole, PrismaClient } from '@prisma/client'

import { newId } from '../../src/common/id'
import { TokenService } from '../../src/modules/auth/services/token.service'

export interface TestActor {
  userId: string
  /** Pass as the `Cookie` header on every supertest request for this actor. */
  cookieHeader: string
  /** Pass as the `X-CSRF-Token` header on every state-changing (non-GET) request for this actor. */
  csrfHeader: string
}

/**
 * Creates a real, active `User` row directly via Prisma and mints a genuine
 * access-token JWT for it via the app's own `TokenService` — the same
 * signing path production login uses — so e2e specs can authenticate as any
 * role/platformRole without driving the full login flow. The CSRF guard is
 * satisfied by the double-submit cookie/header pair sharing an arbitrary
 * shared value, exactly as `CsrfGuard` requires.
 */
export async function createAuthenticatedActor(
  app: INestApplication,
  prisma: PrismaClient,
  overrides: { platformRole?: PlatformRole; roleKeys?: string[]; companyId?: string | null } = {},
): Promise<TestActor> {
  const tokenService = app.get(TokenService)
  const userId = newId()

  // `app_user` has `FORCE ROW LEVEL SECURITY` (phase2_3) — a raw insert
  // through a plain, out-of-band PrismaClient (not one of `RlsService`'s
  // RLS-bound transactions) needs the same `app.bypass_rls` session
  // variable production's `runWithSystemAccess`/`runWithPlatformAccess` set,
  // or Postgres rejects the write under `WITH CHECK`.
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
    return tx.user.create({
      data: {
        id: userId,
        companyId: overrides.companyId ?? null,
        email: `e2e-${userId}@safemeds.test`,
        fullName: 'E2E Test User',
        passwordHash: 'unused-in-e2e',
        status: 'active',
        platformRole: overrides.platformRole,
        roleKeys: overrides.roleKeys ?? [],
      },
    })
  })

  const accessToken = tokenService.signAccessToken(user)
  const csrfToken = 'e2e-csrf-token'

  return {
    userId,
    cookieHeader: `access_token=${accessToken}; csrf=${csrfToken}`,
    csrfHeader: csrfToken,
  }
}
