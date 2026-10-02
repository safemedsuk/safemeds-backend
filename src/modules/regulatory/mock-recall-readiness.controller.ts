import { Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MockRecallReadinessService } from './mock-recall-readiness.service'

@ApiTags('mock-recall-readiness')
@Controller('recalls/:recallId/mock-readiness')
export class MockRecallReadinessController {
  constructor(private readonly mockRecallReadinessService: MockRecallReadinessService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  compute(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.mockRecallReadinessService.computeReadiness(actor, recallId)
  }

  @RequirePermissions('quality.manage_recalls')
  @Post('export')
  export(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string, @Req() req: Request) {
    return this.mockRecallReadinessService.exportForInspectionFile(actor, recallId, { ip: req.ip })
  }
}
