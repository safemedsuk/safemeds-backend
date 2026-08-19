import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AttachPsmfDocumentDto } from './dto/attach-psmf-document.dto'
import { CreatePsmfDto } from './dto/create-psmf.dto'
import { UpdatePsmfContentDto } from './dto/update-psmf-content.dto'
import { PsmfService } from './psmf.service'

@ApiTags('psmf')
@Controller('psmf')
export class PsmfController {
  constructor(private readonly psmfService: PsmfService) {}

  @RequirePermissions('psmf.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePsmfDto, @Req() req: Request) {
    return this.psmfService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('psmf.manage')
  @Post(':id/document')
  attachDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachPsmfDocumentDto,
    @Req() req: Request,
  ) {
    return this.psmfService.attachDocument(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('psmf.manage')
  @Post(':id/content')
  updateContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePsmfContentDto,
    @Req() req: Request,
  ) {
    return this.psmfService.updateContent(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('psmf.manage')
  @Post(':id/generate-document')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.psmfService.generateDocument(user, id, { ip: req.ip })
  }

  @RequirePermissions('psmf.manage')
  @Post(':id/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.psmfService.activate(user, id, { ip: req.ip })
  }

  @RequirePermissions('psmf.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.psmfService.list(user)
  }
}
