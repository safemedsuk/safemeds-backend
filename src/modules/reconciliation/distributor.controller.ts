import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DistributorService } from './distributor.service'
import { CreateDistributorDto } from './dto/create-distributor.dto'
import { ListDistributorsQueryDto } from './dto/list-distributors-query.dto'
import { UpdateDistributorDto } from './dto/update-distributor.dto'

@ApiTags('distributors')
@Controller('distributors')
export class DistributorController {
  constructor(private readonly distributorService: DistributorService) {}

  @RequirePermissions('reconciliation.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDistributorDto,
    @Req() req: Request,
  ) {
    return this.distributorService.create(user, dto, { ip: req.ip })
  }

  // No @RequirePermissions here — see `DistributorService.requireReadAccess()`'s own doc comment.
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDistributorsQueryDto) {
    return this.distributorService.list(user, query)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.distributorService.get(user, id)
  }

  @RequirePermissions('reconciliation.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateDistributorDto,
    @Req() req: Request,
  ) {
    return this.distributorService.update(user, id, dto, { ip: req.ip })
  }
}
