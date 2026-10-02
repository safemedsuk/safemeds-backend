import { Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallCompliancePackService } from './recall-compliance-pack.service'

@ApiTags('recall-compliance-pack')
@Controller('recalls/:recallId/compliance-pack')
export class RecallCompliancePackController {
  constructor(private readonly recallCompliancePackService: RecallCompliancePackService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallCompliancePackService.list(actor, recallId)
  }

  @RequirePermissions('quality.manage_recalls')
  @Post()
  generate(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string, @Req() req: Request) {
    return this.recallCompliancePackService.generate(actor, recallId, { ip: req.ip })
  }
}
