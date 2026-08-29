import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateTrainingTypeDto } from './dto/create-training-type.dto'
import { UpdateTrainingTypeDto } from './dto/update-training-type.dto'
import { TrainingTypeService } from './training-type.service'

@ApiTags('training-types')
@Controller('training-types')
export class TrainingTypeController {
  constructor(private readonly trainingTypeService: TrainingTypeService) {}

  /** Open to any authenticated user — catalog metadata, same treatment as `GET /regulatory-authorities`. */
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('countryId') countryId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.trainingTypeService.list(actor, countryId, includeInactive === 'true')
  }

  @RequirePermissions('platform.config.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateTrainingTypeDto,
    @Req() req: Request,
  ) {
    return this.trainingTypeService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTrainingTypeDto,
    @Req() req: Request,
  ) {
    return this.trainingTypeService.update(actor, id, dto, { ip: req.ip })
  }
}
