import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, User } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { isValidTenantRoleKey } from '../../common/tenant-roles.const'
import { AuditService } from '../audit/audit.service'
import { TokenService } from '../auth/services/token.service'
import { ListUsersQueryDto } from './dto/list-users-query.dto'
import { UpdateUserRolesDto } from './dto/update-user-roles.dto'

export interface RequestMeta {
  ip?: string
}

export interface TenantUserSummary {
  id: string
  email: string
  fullName: string
  status: string
  roleKeys: string[]
  isExternal: boolean
  mustChangePassword: boolean
  createdAt: Date
}

/**
 * Authorization for every method here is `@RequirePermissions()` on the
 * controller (Phase 2.2's `PermissionsGuard`). Tenant *scoping* — never
 * reading another company's users — is now Postgres RLS (Phase 2.3),
 * bound via `RlsService.runAsCompany`: every query below runs against a
 * `tx` whose connection has `app.company_id` set to `actor.companyId`,
 * so even a future edit that "forgets" a `where: { companyId }` clause
 * still can't see another company's rows.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly rls: RlsService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListUsersQueryDto,
  ): Promise<PaginatedResult<TenantUserSummary>> {
    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const where = {
        companyId: actor.companyId!,
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { roleKeys: { has: query.role } } : {}),
      }

      const [rows, total] = await Promise.all([
        tx.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.user.count({ where }),
      ])

      return paginate(rows.map(toSummary), total, query)
    })
  }

  async updateRoles(
    actor: AuthenticatedUser,
    targetUserId: string,
    dto: UpdateUserRolesDto,
    meta: RequestMeta,
  ): Promise<TenantUserSummary> {
    const invalidRole = dto.roleKeys.find((key) => !isValidTenantRoleKey(key))
    if (invalidRole) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message: `Unknown role: ${invalidRole}`,
      })
    }

    return this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const targetUser = await this.findInCompanyOrThrow(tx, actor.companyId!, targetUserId)

      if (
        targetUser.id === actor.sub &&
        targetUser.roleKeys.includes('SYSTEM_ADMINISTRATOR') &&
        !dto.roleKeys.includes('SYSTEM_ADMINISTRATOR')
      ) {
        await this.assertNotLastAdmin(
          tx,
          actor.companyId!,
          targetUser.id,
          'You cannot remove your own System Administrator role',
        )
      }

      // Bumping tokenVersion means the target's *current* access token
      // (roleKeys baked in at sign time) stops validating on their very
      // next request, forcing the client's existing 401->refresh->retry
      // flow to mint a fresh one with the new roleKeys — without this,
      // a role grant/revoke silently doesn't take effect until the
      // access token's natural 15-minute expiry.
      const updated = await tx.user.update({
        where: { id: targetUser.id },
        data: {
          roleKeys: dto.roleKeys,
          isExternal: dto.isExternal ?? targetUser.isExternal,
          tokenVersion: { increment: 1 },
        },
      })
      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'user_roles_updated',
        recordType: 'app_user',
        recordId: targetUser.id,
        oldValue: { roleKeys: targetUser.roleKeys, isExternal: targetUser.isExternal },
        newValue: { roleKeys: dto.roleKeys, isExternal: dto.isExternal ?? targetUser.isExternal },
        ip: meta.ip,
      })

      return toSummary(updated)
    })
  }

  async deactivate(
    actor: AuthenticatedUser,
    targetUserId: string,
    meta: RequestMeta,
  ): Promise<TenantUserSummary> {
    const updated = await this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const targetUser = await this.findInCompanyOrThrow(tx, actor.companyId!, targetUserId)

      if (targetUser.status === 'deactivated') {
        throw new BadRequestException({
          code: 'ALREADY_DEACTIVATED',
          message: 'This user is already deactivated',
        })
      }

      if (targetUser.roleKeys.includes('SYSTEM_ADMINISTRATOR')) {
        await this.assertNotLastAdmin(
          tx,
          actor.companyId!,
          targetUser.id,
          'You cannot deactivate the last System Administrator',
        )
      }

      const result = await tx.user.update({
        where: { id: targetUser.id },
        data: { status: 'deactivated', tokenVersion: { increment: 1 } },
      })
      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'user_deactivated',
        recordType: 'app_user',
        recordId: targetUser.id,
        ip: meta.ip,
      })

      return result
    })

    await this.tokenService.revokeAllForUser(updated.id)

    return toSummary(updated)
  }

  async adminResetPassword(
    actor: AuthenticatedUser,
    targetUserId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const targetUser = await this.rls.runAsCompany(actor.companyId!, async (tx) => {
      const found = await this.findInCompanyOrThrow(tx, actor.companyId!, targetUserId)

      await tx.user.update({
        where: { id: found.id },
        data: { mustChangePassword: true, tokenVersion: { increment: 1 } },
      })
      await this.auditService.log(tx, {
        companyId: actor.companyId,
        actorUserId: actor.sub,
        action: 'password_reset_forced',
        recordType: 'app_user',
        recordId: found.id,
        ip: meta.ip,
      })

      return found
    })

    await this.tokenService.revokeAllForUser(targetUser.id)
  }

  private async findInCompanyOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
  ): Promise<User> {
    const user = await tx.user.findFirst({ where: { id: userId, companyId } })
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' })
    }
    return user
  }

  /**
   * A user's own UI display-language preference — self-service, no
   * permission gate (every authenticated user, tenant or platform, may
   * set this on their own account). Not RLS-scoped to a company lookup
   * since a platform-staff actor (companyId: null) must also be able to
   * call this — the row is addressed by the actor's own id, which the
   * JWT already attests to, so there is no cross-tenant read risk here.
   */
  async setPreferredLocale(
    actorId: string,
    preferredLocale: string,
  ): Promise<{ preferredLocale: string }> {
    const user = await this.rls.runWithSystemAccess((tx) =>
      tx.user.update({
        where: { id: actorId },
        data: { preferredLocale },
        select: { preferredLocale: true },
      }),
    )
    return user
  }

  /** A company that loses every System Administrator can never invite or manage users again — the one hard safety rail on an otherwise-permissive role/deactivate API. */
  private async assertNotLastAdmin(
    tx: Prisma.TransactionClient,
    companyId: string,
    excludingUserId: string,
    message: string,
  ): Promise<void> {
    const otherActiveAdmins = await tx.user.count({
      where: {
        companyId,
        status: 'active',
        roleKeys: { has: 'SYSTEM_ADMINISTRATOR' },
        id: { not: excludingUserId },
      },
    })

    if (otherActiveAdmins === 0) {
      throw new ForbiddenException({ code: 'LAST_ADMIN', message })
    }
  }
}

function toSummary(user: User): TenantUserSummary {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roleKeys: user.roleKeys,
    isExternal: user.isExternal,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  }
}
