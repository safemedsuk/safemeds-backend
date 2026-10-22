import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListUsersQueryDto } from './dto/list-users-query.dto'
import { UpdatePreferredLocaleDto } from './dto/update-preferred-locale.dto'
import { UpdateUserRolesDto } from './dto/update-user-roles.dto'
import { UsersService } from './users.service'

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions('users.view')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListUsersQueryDto) {
    return this.usersService.list(actor, query)
  }

  /** Self-service only — no permission gate, matches change-password's own "acting on your own account" precedent. */
  @Patch('me/locale')
  updatePreferredLocale(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdatePreferredLocaleDto,
  ) {
    return this.usersService.setPreferredLocale(actor.sub, dto.preferredLocale)
  }

  @RequirePermissions('users.manage_roles')
  @Patch(':id/roles')
  updateRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRolesDto,
    @Req() req: Request,
  ) {
    return this.usersService.updateRoles(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('users.deactivate')
  @Post(':id/deactivate')
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.usersService.deactivate(actor, id, { ip: req.ip })
  }

  @RequirePermissions('users.reset_password')
  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.usersService.adminResetPassword(actor, id, { ip: req.ip })
    return { reset: true }
  }
}
