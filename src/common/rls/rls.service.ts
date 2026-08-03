import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { AuditService } from '../../modules/audit/audit.service'
import { PrismaService } from '../../prisma/prisma.service'
import { rlsAls } from './rls-context'

/**
 * The application-side half of Phase 2.3's Postgres RLS. Postgres enforces
 * the actual isolation (see the `..._rls_tenant_isolation` migration) —
 * this service is only responsible for setting the two session variables
 * those policies read, inside the same transaction as the query, every
 * time, so "forgetting" is structurally impossible for code that goes
 * through it: there is no `tx` to query with except the one returned by
 * these methods, and that `tx`'s connection already has the RLS context
 * bound before your callback ever runs.
 *
 * Three entry points, matching the three legitimate reasons a query needs
 * a specific RLS context:
 *
 * - `runAsCompany` — the normal case: an authenticated tenant user acting
 *   within their own company. Used by every tenancy-module service method.
 * - `runWithSystemAccess` — the narrow set of lookups that must happen
 *   *before* a company is known at all: resolving identity by email
 *   (login, registration's uniqueness check) or by a single-use token
 *   (password reset, invitation accept/verify) — the whole reason those
 *   flows exist is to establish who's asking, so they cannot themselves
 *   already be scoped to a company. Every call site is a narrow,
 *   single-row lookup by a unique key, never a list/scan.
 * - `runWithPlatformAccess` — SafeMeds staff reading across tenants.
 *   Structurally cannot be silent: it always writes a `platform_access`
 *   audit entry in the same transaction as the read it's gating.
 *
 * A nested call (e.g. a private helper that itself calls `runAsCompany`
 * while already inside one) reuses the existing transaction via
 * `rlsAls` instead of attempting a real nested Postgres transaction
 * (which Prisma doesn't support) — this is what makes it safe for
 * service methods to call each other without every caller needing to
 * know whether it's already inside an RLS-bound transaction.
 */
@Injectable()
export class RlsService {
  constructor(
    private readonly prisma: PrismaService,
    // `forwardRef` breaks a genuine cycle: `AuditService`'s Phase 3.2 query
    // methods (`GET /audit`) need `runAsCompany`/`runWithSystemAccess` to
    // read through an RLS-bound `tx` (otherwise the actor→app_user join is
    // invisible under FORCE ROW LEVEL SECURITY), while `runWithPlatformAccess`
    // here needs `AuditService.log()` to record the access it's gating.
    @Inject(forwardRef(() => AuditService))
    private readonly auditService: AuditService,
  ) {}

  async runAsCompany<T>(
    companyId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const existing = rlsAls.getStore()
    if (existing) {
      return fn(existing.tx)
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`
      return rlsAls.run({ tx }, () => fn(tx))
    })
  }

  async runWithSystemAccess<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const existing = rlsAls.getStore()
    if (existing) {
      return fn(existing.tx)
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      return rlsAls.run({ tx }, () => fn(tx))
    })
  }

  async runWithPlatformAccess<T>(
    actorUserId: string,
    reason: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`
      const result = await rlsAls.run({ tx }, () => fn(tx))
      await this.auditService.log(tx, {
        actorUserId,
        actorType: 'user',
        action: 'platform_access',
        recordType: 'system',
        newValue: { reason },
      })
      return result
    })
  }
}
