import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AddManagementReviewAttendeeDto } from './dto/management-review-attendee.dto'
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

  /** Pass B (item E) — add one attendee by name. */
  @RequirePermissions('quality.manage_management_review')
  @Post(':id/attendees')
  addAttendee(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddManagementReviewAttendeeDto,
    @Req() req: Request,
  ) {
    return this.managementReviewService.addAttendee(actor, id, dto, { ip: req.ip })
  }

  /** Pass B (item E) — remove an attendee entered in error (stamped, never deleted). */
  @RequirePermissions('quality.manage_management_review')
  @Post(':id/attendees/:attendeeId/withdraw')
  withdrawAttendee(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Req() req: Request,
  ) {
    return this.managementReviewService.withdrawAttendee(actor, id, attendeeId, { ip: req.ip })
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
