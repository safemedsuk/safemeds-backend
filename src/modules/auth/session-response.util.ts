import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'crypto'
import type { Response } from 'express'

import { RlsService } from '../../common/rls/rls.service'
import { EnvConfig } from '../../config/env.validation'
import { RolesService } from '../roles/roles.service'
import { setAuthCookies } from './cookie.util'
import { LoginSuccessResult } from './services/session.service'

export function safeUser(
  user: {
    id: string
    email: string
    fullName: string
    companyId: string | null
    roleKeys: string[]
    platformRole: string | null
    mustChangePassword: boolean
    preferredLocale?: string
  },
  companyName?: string | null,
  permissions?: string[],
) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    companyId: user.companyId,
    companyName: companyName ?? null,
    roleKeys: user.roleKeys,
    platformRole: user.platformRole,
    mustChangePassword: user.mustChangePassword,
    /** UI display language only — see todo-i18n.md. Defaults 'en' for every new user, changed only via PATCH /users/me/locale. */
    preferredLocale: user.preferredLocale ?? 'en',
    /** Resolved once here at login/refresh time — the FE's usePermissions() hook reads this directly rather than re-deriving it, the server is still the enforcer either way. */
    permissions,
  }
}

/**
 * Shared by every entry point that ends in a full session — password
 * login, MFA challenge, and post-invitation email verification — so the
 * cookie-setting and response-shaping logic lives in exactly one place.
 */
export async function finalizeSessionResponse(
  result: LoginSuccessResult,
  res: Response,
  configService: ConfigService<EnvConfig, true>,
  rls: RlsService,
  rolesService: RolesService,
) {
  const csrfToken = randomBytes(32).toString('hex')

  setAuthCookies(res, configService, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken.plaintext,
    csrfToken,
    refreshExpiresAt: result.refreshToken.expiresAt,
  })

  const [securityPolicy, permissions] = await Promise.all([
    result.user.companyId
      ? rls.runAsCompany(result.user.companyId, (tx) =>
          tx.securityPolicy.findUnique({ where: { companyId: result.user.companyId! } }),
        )
      : Promise.resolve(null),
    rolesService.getPermissionsForUser({
      sub: result.user.id,
      companyId: result.user.companyId,
      roleKeys: result.user.roleKeys,
      platformRole: result.user.platformRole,
      tokenVersion: result.user.tokenVersion,
    }),
  ])

  return {
    mfaRequired: false as const,
    user: safeUser(result.user, result.user.company?.name, Array.from(permissions)),
    mfaSetupRequired: result.mfaSetupRequired,
    securityPolicy: securityPolicy
      ? {
          minPasswordLength: securityPolicy.minPasswordLength,
          sessionTimeoutMinutes: securityPolicy.sessionTimeoutMinutes,
          mfaRequiredForSignatureRoles: securityPolicy.mfaRequiredForSignatureRoles,
        }
      : null,
  }
}
