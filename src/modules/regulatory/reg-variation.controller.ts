import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRegVariationDto } from './dto/create-reg-variation.dto'
import { RegVariationService } from './reg-variation.service'

@ApiTags('reg-variations')
@Controller('reg-variations')
@RequirePermissions('regulatory.view_all')
export class RegVariationController {
  constructor(private readonly regVariationService: RegVariationService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('productRegistrationId') productRegistrationId: string,
  ) {
    return this.regVariationService.list(actor, productRegistrationId)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.regVariationService.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_variations')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegVariationDto,
    @Req() req: Request,
  ) {
    return this.regVariationService.create(actor, dto, { ip: req.ip })
  }
}
