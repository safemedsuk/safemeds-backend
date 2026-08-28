import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GrantLocationScopeDto } from './dto/grant-location-scope.dto'
import { LocationScopeService } from './location-scope.service'

@ApiTags('location-scopes')
@Controller()
export class LocationScopeController {
  constructor(private readonly locationScopeService: LocationScopeService) {}

  /** Any authenticated tenant user can see their own effective access shape — used by the FE to decide whether to show the two-altitude view switcher. */
  @Get('location-scopes/mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.locationScopeService.getMyEffectiveAccess(user)
  }

  @RequirePermissions('users.manage_roles')
  @Get('users/:userId/location-scopes')
  listForUser(@CurrentUser() user: AuthenticatedUser, @Param('userId') userId: string) {
    return this.locationScopeService.listForUser(user, userId)
  }

  @RequirePermissions('users.manage_roles')
  @Post('users/:userId/location-scopes')
  grant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: GrantLocationScopeDto,
    @Req() req: Request,
  ) {
    return this.locationScopeService.grant(user, userId, dto, { ip: req.ip })
  }

  @RequirePermissions('users.manage_roles')
  @Delete('location-scopes/:id')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.locationScopeService.revoke(user, id, { ip: req.ip })
    return { revoked: true }
  }
}
