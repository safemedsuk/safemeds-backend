import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ConfirmDuplicateDto } from './dto/confirm-duplicate.dto'
import { DismissDuplicateDto } from './dto/dismiss-duplicate.dto'
import { DuplicateDetectionService } from './duplicate-detection.service'

/**
 * VigiCloud Stage 10 — confirming/dismissing a `DuplicateReview`. Gated
 * by `pv.triage_case` throughout: deciding whether two cases are real
 * duplicates (and, if so, which pattern resolves them) is the same kind
 * of PV judgment call the seeded workflow already trusts that permission
 * with for triage classification, not a new dedicated permission.
 */
@ApiTags('pv-duplicate-reviews')
@Controller('pv/duplicate-reviews')
export class DuplicateReviewController {
  constructor(private readonly duplicateDetectionService: DuplicateDetectionService) {}

  @RequirePermissions('pv.triage_case')
  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmDuplicateDto,
    @Req() req: Request,
  ) {
    return this.duplicateDetectionService.confirmDuplicate(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('pv.triage_case')
  @Post(':id/dismiss')
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DismissDuplicateDto,
    @Req() req: Request,
  ) {
    return this.duplicateDetectionService.dismissDuplicate(user, id, dto, { ip: req.ip })
  }
}
