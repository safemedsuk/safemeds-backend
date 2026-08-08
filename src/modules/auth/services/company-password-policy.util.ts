import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'

import { EnvConfig } from '../../../config/env.validation'

/**
 * The minimum password length a *new* password must meet for this
 * company — its `SecurityPolicy.minPasswordLength` if one exists, else
 * the platform-wide floor. Deliberately never used to re-validate a
 * password someone already has: raising a company's policy only affects
 * passwords set from that point forward (invitation accept, reset,
 * change), it does not retroactively invalidate anyone's current one.
 *
 * `security_policy` has RLS enforced (Phase 2.3) — `tx` must already be
 * bound to an RLS context (`RlsService.runAsCompany`/`runWithSystemAccess`)
 * by the caller, or this always returns the platform floor regardless of
 * the company's real policy (RLS fails the query closed, not open).
 */
export async function getCompanyMinPasswordLength(
  tx: Prisma.TransactionClient,
  configService: ConfigService<EnvConfig, true>,
  companyId: string | null,
): Promise<number> {
  if (!companyId) {
    return configService.get('PASSWORD_MIN_LENGTH', { infer: true })
  }

  const policy = await tx.securityPolicy.findUnique({ where: { companyId } })
  return policy?.minPasswordLength ?? configService.get('PASSWORD_MIN_LENGTH', { infer: true })
}
