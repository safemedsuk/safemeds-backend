import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreatePermissionDto } from './dto/create-permission.dto'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto'
import { RbacAdminService } from './rbac-admin.service'

@ApiTags('rbac-admin')
@Controller('rbac-admin')
export class RbacAdminController {
  constructor(private readonly service: RbacAdminService) {}

  /** Open to any authenticated user — same treatment as `GET /roles`, which already exposes the identical role↔permission relationship the other way round. */
  @Get('permissions')
  listPermissions() {
    return this.service.listPermissions()
  }

  @RequirePermissions('platform.rbac.manage')
  @Post('permissions')
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.service.createPermission(dto)
  }

  @RequirePermissions('platform.rbac.manage')
  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.service.createRole(dto)
  }

  @RequirePermissions('platform.rbac.manage')
  @Get('roles/:key/impact')
  getRoleImpact(@CurrentUser() actor: AuthenticatedUser, @Param('key') key: string) {
    return this.service.getRoleImpact(actor, key)
  }

  @RequirePermissions('platform.rbac.manage')
  @Patch('roles/:key/permissions')
  updateRolePermissions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.service.updateRolePermissions(actor, key, dto)
  }
}
