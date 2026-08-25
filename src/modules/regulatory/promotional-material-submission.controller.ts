import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AttachPromotionalMaterialDocumentDto } from './dto/attach-promotional-material-document.dto'
import { CreatePromotionalMaterialSubmissionDto } from './dto/create-promotional-material-submission.dto'
import { ListPromotionalMaterialSubmissionsQueryDto } from './dto/list-promotional-material-submissions-query.dto'
import { PromotionalMaterialSubmissionService } from './promotional-material-submission.service'

@ApiTags('promotional-material-submissions')
@Controller('promotional-material-submissions')
@RequirePermissions('regulatory.view_all')
export class PromotionalMaterialSubmissionController {
  constructor(private readonly service: PromotionalMaterialSubmissionService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListPromotionalMaterialSubmissionsQueryDto,
  ) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_promotional_material')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreatePromotionalMaterialSubmissionDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_promotional_material')
  @Post(':id/material-document')
  attachMaterialDocument(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachPromotionalMaterialDocumentDto,
    @Req() req: Request,
  ) {
    return this.service.attachMaterialDocument(actor, id, dto, { ip: req.ip })
  }
}
