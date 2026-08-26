import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AddParticipatingAuthorityDto } from './dto/add-participating-authority.dto'
import { CreateRelianceApplicationDto } from './dto/create-reliance-application.dto'
import { ListRelianceApplicationsQueryDto } from './dto/list-reliance-applications-query.dto'
import { StartAuthorityDossierDto } from './dto/start-authority-dossier.dto'
import { RelianceApplicationService } from './reliance-application.service'

@ApiTags('reliance-applications')
@Controller('reliance-applications')
@RequirePermissions('regulatory.view_all')
export class RelianceApplicationController {
  constructor(private readonly service: RelianceApplicationService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRelianceApplicationsQueryDto) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRelianceApplicationDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/authorities')
  addParticipatingAuthority(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddParticipatingAuthorityDto,
    @Req() req: Request,
  ) {
    return this.service.addParticipatingAuthority(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/start-dossier')
  startDossierForAuthority(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: StartAuthorityDossierDto,
    @Req() req: Request,
  ) {
    return this.service.startDossierForAuthority(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/close')
  close(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.close(actor, id, { ip: req.ip })
  }
}
