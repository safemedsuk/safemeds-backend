import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateInvitationDto } from './dto/create-invitation.dto'
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto'
import { InvitationsService } from './invitations.service'

@ApiTags('invitations')
@Controller('invitations')
@RequirePermissions('users.invite')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request,
  ) {
    return this.invitationsService.create(user, dto, { ip: req.ip })
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInvitationsQueryDto) {
    return this.invitationsService.list(user, query)
  }

  @Post(':id/resend')
  async resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.invitationsService.resend(user, id, { ip: req.ip })
    return { resent: true }
  }

  @Delete(':id')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.invitationsService.revoke(user, id, { ip: req.ip })
    return { revoked: true }
  }
}
