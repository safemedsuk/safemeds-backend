import { Prisma, User } from '@prisma/client'

import { hasSignatureGatedRole } from '../mfa-signature-roles.const'

/**
 * True when the company's security policy mandates MFA for this user's
 * signature-gated roles (QPPV / Quality Manager / Reg Affairs) but they
 * haven't set it up yet. Shared by `SessionService` (gates login — the FE
 * forces the setup wizard on next screen, same pattern as
 * `user.mustChangePassword`) and `ReauthService` (gates minting a
 * signature token — a role can be granted mid-session, after login already
 * computed this once, so the signing path needs its own fresh check
 * rather than trusting a stale login-time result).
 */
export async function computeMfaSetupRequired(
  tx: Prisma.TransactionClient,
  user: User,
): Promise<boolean> {
  if (!user.companyId || !hasSignatureGatedRole(user.roleKeys)) {
    return false
  }

  const [policy, mfaCredential] = await Promise.all([
    tx.securityPolicy.findUnique({ where: { companyId: user.companyId } }),
    tx.mfaCredential.findUnique({ where: { userId: user.id } }),
  ])

  if (mfaCredential?.enabledAt) {
    return false
  }

  return Boolean(policy?.mfaRequiredForSignatureRoles)
}
