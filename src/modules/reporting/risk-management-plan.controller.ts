import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AttachRmpDocumentDto } from './dto/attach-rmp-document.dto'
import { CreateRmpDto } from './dto/create-rmp.dto'
import { UpdateRmpContentDto } from './dto/update-rmp-content.dto'
import { UpdateRmpRenewalDto } from './dto/update-rmp-renewal.dto'
import { RiskManagementPlanService } from './risk-management-plan.service'

@ApiTags('risk-management-plans')
@Controller('rmp')
export class RiskManagementPlanController {
  constructor(private readonly rmpService: RiskManagementPlanService) {}

  @RequirePermissions('rmp.manage')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRmpDto, @Req() req: Request) {
    return this.rmpService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('rmp.manage')
  @Post(':id/document')
  attachDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachRmpDocumentDto,
    @Req() req: Request,
  ) {
    return this.rmpService.attachDocument(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('rmp.manage')
  @Post(':id/content')
  updateContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRmpContentDto,
    @Req() req: Request,
  ) {
    return this.rmpService.updateContent(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('rmp.manage')
  @Post(':id/generate-document')
  generateDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.rmpService.generateDocument(user, id, { ip: req.ip })
  }

  @RequirePermissions('rmp.manage')
  @Post(':id/activate')
  activate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.rmpService.activate(user, id, { ip: req.ip })
  }

  @RequirePermissions('rmp.manage')
  @Patch(':id/renewal')
  updateRenewal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRmpRenewalDto,
    @Req() req: Request,
  ) {
    return this.rmpService.updateRenewal(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('rmp.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId?: string) {
    return this.rmpService.list(user, productId)
  }
}
