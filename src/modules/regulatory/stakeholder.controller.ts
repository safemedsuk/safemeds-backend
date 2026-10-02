import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateStakeholderDto } from './dto/create-stakeholder.dto'
import { ListStakeholdersQueryDto } from './dto/list-stakeholders-query.dto'
import { UpdateStakeholderDto } from './dto/update-stakeholder.dto'
import { StakeholderService } from './stakeholder.service'

@ApiTags('stakeholders')
@Controller('stakeholders')
export class StakeholderController {
  constructor(private readonly stakeholderService: StakeholderService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListStakeholdersQueryDto) {
    return this.stakeholderService.list(actor, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.stakeholderService.get(actor, id)
  }

  @RequirePermissions('quality.log_recall')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateStakeholderDto,
    @Req() req: Request,
  ) {
    return this.stakeholderService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStakeholderDto,
    @Req() req: Request,
  ) {
    return this.stakeholderService.update(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post(':id/deactivate')
  deactivate(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.stakeholderService.deactivate(actor, id, { ip: req.ip })
  }
}
