import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallPortalLinkDto } from './dto/create-recall-portal-link.dto'
import { RecallPortalService } from './recall-portal.service'

@ApiTags('recall-portal')
@Controller()
export class RecallPortalController {
  constructor(private readonly recallPortalService: RecallPortalService) {}

  @RequirePermissions('quality.view_all')
  @Get('recalls/:recallId/portal-links')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallPortalService.listLinks(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('recalls/:recallId/portal-links')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallPortalLinkDto,
    @Req() req: Request,
  ) {
    return this.recallPortalService.createLink(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-portal-links/:id/revoke')
  revoke(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.recallPortalService.revokeLink(actor, id, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get('recall-portal-links/:id/actions')
  listActions(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.recallPortalService.listActions(actor, id)
  }
}
