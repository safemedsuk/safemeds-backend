import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import {
  CreateStabilityStudyDto,
  RecordStabilityTimepointResultsDto,
  UpdateStabilityStudyStatusDto,
} from './dto/stability.dto'
import { StabilityService } from './stability.service'

@ApiTags('quality-stability')
@Controller('quality/stability-studies')
export class StabilityController {
  constructor(private readonly service: StabilityService) {}

  @RequirePermissions('quality.manage_stability')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStabilityStudyDto, @Req() req: Request) {
    return this.service.createStudy(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId?: string) {
    return this.service.list(user, productId)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @RequirePermissions('quality.manage_stability')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStabilityStudyStatusDto,
    @Req() req: Request,
  ) {
    return this.service.updateStatus(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_stability')
  @Post('timepoints/:timepointId/results')
  recordResults(
    @CurrentUser() user: AuthenticatedUser,
    @Param('timepointId') timepointId: string,
    @Body() dto: RecordStabilityTimepointResultsDto,
    @Req() req: Request,
  ) {
    return this.service.recordResults(user, timepointId, dto, { ip: req.ip })
  }
}
