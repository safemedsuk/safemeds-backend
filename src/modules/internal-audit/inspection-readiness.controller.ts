import { Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InspectionReadinessService } from './inspection-readiness.service'

@ApiTags('inspection-readiness')
@Controller('inspection-readiness')
@RequirePermissions('quality.view_all')
export class InspectionReadinessController {
  constructor(private readonly service: InspectionReadinessService) {}

  @Get()
  getSnapshot(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.getSnapshot(actor)
  }

  @RequirePermissions('quality.manage_capa')
  @Post('packs')
  generatePack(@CurrentUser() actor: AuthenticatedUser, @Req() req: Request) {
    return this.service.generatePack(actor, { ip: req.ip })
  }

  @Get('packs')
  listPacks(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.listPacks(actor)
  }

  @Get('packs/:id')
  getPack(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getPack(actor, id)
  }
}
