import { Injectable } from '@nestjs/common'
import { Role } from '@prisma/client'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PrismaService } from '../../prisma/prisma.service'

export interface PermissionSummary {
  key: string
  description: string
}

export interface RoleWithPermissions {
  key: string
  name: string
  description: string
  isPlatform: boolean
  permissions: PermissionSummary[]
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full catalog — powers the invite-role picker and any future admin role-management UI. */
  async listCatalog(): Promise<RoleWithPermissions[]> {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: [{ isPlatform: 'asc' }, { name: 'asc' }],
    })

    return roles.map(toRoleWithPermissions)
  }

  /**
   * Resolves an authenticated user's `roleKeys`/`platformRole` (whichever
   * side they're on — never both) to the union of every permission key
   * their roles grant. One query per call; `PermissionsGuard` memoizes the
   * result per-request so a handler checking multiple permissions doesn't
   * repeat this for the same request.
   */
  async getPermissionsForUser(user: AuthenticatedUser): Promise<Set<string>> {
    const roleKeys = user.platformRole ? [user.platformRole] : user.roleKeys
    if (roleKeys.length === 0) {
      return new Set()
    }

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } } },
      include: { permission: true },
    })

    return new Set(rolePermissions.map((rp) => rp.permission.key))
  }
}

function toRoleWithPermissions(
  role: Role & { permissions: { permission: { key: string; description: string } }[] },
): RoleWithPermissions {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    isPlatform: role.isPlatform,
    permissions: role.permissions.map((rp) => ({
      key: rp.permission.key,
      description: rp.permission.description,
    })),
  }
}
