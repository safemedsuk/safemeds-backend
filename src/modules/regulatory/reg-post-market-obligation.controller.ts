import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRegPostMarketObligationDto } from './dto/create-reg-post-market-obligation.dto'
import { FulfillRegPostMarketObligationDto } from './dto/fulfill-reg-post-market-obligation.dto'
import { ListRegPostMarketObligationsQueryDto } from './dto/list-reg-post-market-obligations-query.dto'
import { RegPostMarketObligationService } from './reg-post-market-obligation.service'

@ApiTags('reg-post-market-obligations')
@Controller('reg-post-market-obligations')
@RequirePermissions('regulatory.view_all')
export class RegPostMarketObligationController {
  constructor(private readonly service: RegPostMarketObligationService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListRegPostMarketObligationsQueryDto,
  ) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_obligations')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegPostMarketObligationDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_obligations')
  @Post(':id/fulfill')
  fulfill(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FulfillRegPostMarketObligationDto,
    @Req() req: Request,
  ) {
    return this.service.fulfill(actor, id, dto, { ip: req.ip })
  }
}
