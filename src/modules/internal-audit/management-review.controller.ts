import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecordManagementReviewActionsDto } from './dto/record-management-review-actions.dto'
import { ScheduleManagementReviewDto } from './dto/schedule-management-review.dto'
import { ManagementReviewService } from './management-review.service'

@ApiTags('management-reviews')
@Controller('management-reviews')
@RequirePermissions('quality.view_metrics')
export class ManagementReviewController {
  constructor(private readonly managementReviewService: ManagementReviewService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.managementReviewService.list(actor)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.managementReviewService.get(actor, id)
  }

  @RequirePermissions('quality.manage_management_review')
  @Post()
  schedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ScheduleManagementReviewDto,
    @Req() req: Request,
  ) {
    return this.managementReviewService.schedule(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_management_review')
  @Post(':id/actions')
  recordActions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordManagementReviewActionsDto,
    @Req() req: Request,
  ) {
    return this.managementReviewService.recordActions(actor, id, dto, { ip: req.ip })
  }
}
