import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { AttachSdeaDocumentDto } from './dto/attach-sdea-document.dto'
import { CreateSdeaDto } from './dto/create-sdea.dto'
import { SdeaService } from './sdea.service'

@ApiTags('sdea')
@Controller('sdea')
export class SdeaController {
  constructor(private readonly sdeaService: SdeaService) {}

  @RequirePermissions('sdea.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSdeaDto, @Req() req: Request) {
    return this.sdeaService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('sdea.manage')
  @Post(':id/document')
  attachDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachSdeaDocumentDto,
    @Req() req: Request,
  ) {
    return this.sdeaService.attachDocument(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('sdea.manage')
  @Post(':id/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.sdeaService.activate(user, id, { ip: req.ip })
  }

  @RequirePermissions('sdea.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.sdeaService.list(user, query)
  }

  @RequirePermissions('sdea.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sdeaService.get(user, id)
  }

  @RequirePermissions('sdea.view')
  @Get('distributor/:distributorId/status')
  getStatusForDistributor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('distributorId') distributorId: string,
  ) {
    return this.sdeaService.getStatusForDistributor(user, distributorId)
  }
}
