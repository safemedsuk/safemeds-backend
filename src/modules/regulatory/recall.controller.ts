import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallDto } from './dto/create-recall.dto'
import { LinkRecallCasesDto } from './dto/link-recall-cases.dto'
import { ListRecallsQueryDto } from './dto/list-recalls-query.dto'
import { RecallService } from './recall.service'

@ApiTags('recalls')
@Controller('recalls')
@RequirePermissions('regulatory.view_all')
export class RecallController {
  constructor(private readonly service: RecallService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRecallsQueryDto) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_recalls')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRecallDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_recalls')
  @Post(':id/link-cases')
  linkCases(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkRecallCasesDto,
    @Req() req: Request,
  ) {
    return this.service.linkCases(actor, id, dto.caseIds, { ip: req.ip })
  }
}
