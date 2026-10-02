import { Controller, Get, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallEvidenceService } from './recall-evidence.service'

@ApiTags('recall-evidence')
@Controller('recalls/:recallId/evidence')
export class RecallEvidenceController {
  constructor(private readonly recallEvidenceService: RecallEvidenceService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallEvidenceService.listEvidence(actor, recallId)
  }
}
