import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DeviationService } from './deviation.service'
import { CreateDeviationDto } from './dto/create-deviation.dto'
import { ListDeviationsQueryDto } from './dto/list-deviations-query.dto'
import { OpenCapaForDeviationDto } from './dto/open-capa-for-deviation.dto'
import { RecordInvestigationDto } from './dto/record-investigation.dto'

@ApiTags('quality-deviations')
@Controller('quality/deviations')
export class DeviationController {
  constructor(private readonly deviationService: DeviationService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDeviationsQueryDto) {
    return this.deviationService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.deviationService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeviationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/investigation')
  recordInvestigation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordInvestigationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.recordInvestigation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/capa')
  openCapaForDeviation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCapaForDeviationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.openCapaForDeviation(user, id, dto, { ip: req.ip })
  }
}
