import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { PrismaService } from '../../prisma/prisma.service'
import { CreatePermissionDto } from './dto/create-permission.dto'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto'

export interface PermissionWithRoles {
  key: string
  description: string
  roleKeys: string[]
}

export interface RoleImpact {
  roleKey: string
  userCount: number
  companyCount: number
}

/**
 * Admin Configuration Console — Gap 4. Before this module, the only way
 * to change what a role can do (or add a new permission/role at all)
 * was editing `prisma/rbac.seed-data.ts` by hand and re-seeding. Roles
 * carry no `companyId` — they're one shared definition for every
 * company on the platform — so every write here is gated
 * `platform.rbac.manage`, the same blast-radius reasoning
 * `platform.config.manage` already applies to country config.
 *
 * `@RequirePermissions()` checks elsewhere in the codebase stay
 * hardcoded strings on purpose — this module only makes *which roles
 * carry which of those already-hardcoded keys* into live data. Adding a
 * permission key here that no endpoint checks for is harmless (an inert
 * grant); it becomes meaningful only once an engineer wires a real
 * `@RequirePermissions()` decorator to it in a later code change. See
 * `CreatePermissionDto`'s own doc comment.
 */
@Injectable()
export class RbacAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsService,
  ) {}

  async listPermissions(): Promise<PermissionWithRoles[]> {
    const permissions = await this.prisma.permission.findMany({
      include: { roles: { include: { role: true } } },
      orderBy: { key: 'asc' },
    })

    return permissions.map((p) => ({
      key: p.key,
      description: p.description,
      roleKeys: p.roles.map((rp) => rp.role.key).sort(),
    }))
  }

  async createPermission(dto: CreatePermissionDto): Promise<{ key: string; description: string }> {
    try {
      const created = await this.prisma.permission.create({
        data: { id: newId(), key: dto.key, description: dto.description },
      })
      return { key: created.key, description: created.description }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'PERMISSION_ALREADY_EXISTS',
          message: `Permission "${dto.key}" already exists`,
        })
      }
      throw err
    }
  }

  async createRole(
    dto: CreateRoleDto,
  ): Promise<{
    key: string
    name: string
    description: string
    isPlatform: boolean
    permissions: string[]
  }> {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.permissions } },
    })
    const missing = dto.permissions.filter((k) => !permissions.some((p) => p.key === k))
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'UNKNOWN_PERMISSIONS',
        message: `Unknown permission key(s): ${missing.join(', ')}`,
      })
    }

    try {
      const role = await this.prisma.role.create({
        data: {
          id: newId(),
          key: dto.key,
          name: dto.name,
          description: dto.description,
          isPlatform: dto.isPlatform ?? false,
          permissions: {
            create: permissions.map((p) => ({ permissionId: p.id })),
          },
        },
      })
      return {
        key: role.key,
        name: role.name,
        description: role.description,
        isPlatform: role.isPlatform,
        permissions: dto.permissions,
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'ROLE_ALREADY_EXISTS',
          message: `Role "${dto.key}" already exists`,
        })
      }
      throw err
    }
  }

  /**
   * How many real users, and how many companies, would be affected by
   * changing this role's permission set right now — the number the
   * frontend's own confirmation dialog shows before a role edit is
   * submitted. Deliberately a separate, cheap read rather than folded
   * into `updateRolePermissions` itself, so the UI can show it before
   * the admin commits to anything.
   */
  async getRoleImpact(actor: AuthenticatedUser, roleKey: string): Promise<RoleImpact> {
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } })
    if (!role) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Role "${roleKey}" not found` })
    }

    return this.rls.runWithPlatformAccess(
      actor.sub,
      `rbac_role_impact_preview:${roleKey}`,
      async (tx) => {
        const where = role.isPlatform
          ? { platformRole: roleKey as never }
          : { roleKeys: { has: roleKey } }
        const users = await tx.user.findMany({ where, select: { companyId: true } })
        return {
          roleKey,
          userCount: users.length,
          companyCount: new Set(users.map((u) => u.companyId ?? 'platform')).size,
        }
      },
    )
  }

  /**
   * Full-replace a role's permission set, then bump `tokenVersion` on
   * every real user currently holding that role — a role-*definition*
   * change affects every user holding it, at every company, all at
   * once, the same mechanical need `UsersService.updateRoles()`
   * already established for a single user, just at platform scale.
   * Both the `RolePermission` replace and the bulk `tokenVersion` bump
   * happen inside the same `runWithPlatformAccess` transaction, so a
   * failure partway through can never leave permissions changed but
   * tokens not yet invalidated (or vice versa).
   */
  async updateRolePermissions(
    actor: AuthenticatedUser,
    roleKey: string,
    dto: UpdateRolePermissionsDto,
  ): Promise<RoleImpact> {
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } })
    if (!role) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Role "${roleKey}" not found` })
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.permissions } },
    })
    const missing = dto.permissions.filter((k) => !permissions.some((p) => p.key === k))
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'UNKNOWN_PERMISSIONS',
        message: `Unknown permission key(s): ${missing.join(', ')}`,
      })
    }

    return this.rls.runWithPlatformAccess(
      actor.sub,
      `rbac_role_permissions_updated:${roleKey}`,
      async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } })
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
          })
        }

        const where = role.isPlatform
          ? { platformRole: roleKey as never }
          : { roleKeys: { has: roleKey } }
        const affected = await tx.user.updateManyAndReturn({
          where,
          data: { tokenVersion: { increment: 1 } },
          select: { companyId: true },
        })

        return {
          roleKey,
          userCount: affected.length,
          companyCount: new Set(affected.map((u) => u.companyId ?? 'platform')).size,
        }
      },
    )
  }
}
