import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallSightingDto } from './dto/create-recall-sighting.dto'
import { ReviewRecallSightingDto } from './dto/review-recall-sighting.dto'
import { RecallSightingService } from './recall-sighting.service'

@ApiTags('recall-sightings')
@Controller()
export class RecallSightingController {
  constructor(private readonly recallSightingService: RecallSightingService) {}

  @RequirePermissions('quality.view_all')
  @Get('recalls/:recallId/sightings')
  list(@CurrentUser() actor: AuthenticatedUser, @Param('recallId') recallId: string) {
    return this.recallSightingService.list(actor, recallId)
  }

  @RequirePermissions('quality.log_recall')
  @Post('recalls/:recallId/sightings')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('recallId') recallId: string,
    @Body() dto: CreateRecallSightingDto,
    @Req() req: Request,
  ) {
    return this.recallSightingService.create(actor, recallId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post('recall-sightings/:id/review')
  review(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewRecallSightingDto,
    @Req() req: Request,
  ) {
    return this.recallSightingService.review(actor, id, dto, { ip: req.ip })
  }
}
