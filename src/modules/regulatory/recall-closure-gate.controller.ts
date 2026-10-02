import { Controller, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallClosureGateService } from './recall-closure-gate.service'

@ApiTags('recall-closure-gate')
@Controller('recalls/:recallId/closure-readiness')
export class RecallClosureGateController {
  constructor(private readonly recallClosureGateService: RecallClosureGateService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  check(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallClosureGateService.check(actor, recallId)
  }
}
