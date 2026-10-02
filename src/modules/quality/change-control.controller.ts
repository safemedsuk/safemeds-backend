import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ChangeControlService } from './change-control.service'
import { AssessChangeImpactDto } from './dto/assess-change-impact.dto'
import { CreateChangeControlDto } from './dto/create-change-control.dto'
import { ListChangeControlsQueryDto } from './dto/list-change-controls-query.dto'
import { OpenLinkedVariationDto } from './dto/open-linked-variation.dto'
import { RecordChangeApprovalDto } from './dto/record-change-approval.dto'
import { RecordChangeImplementationDto } from './dto/record-change-implementation.dto'

@ApiTags('quality-change-control')
@Controller('quality/change-controls')
export class ChangeControlController {
  constructor(private readonly changeControlService: ChangeControlService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListChangeControlsQueryDto) {
    return this.changeControlService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.changeControlService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChangeControlDto,
    @Req() req: Request,
  ) {
    return this.changeControlService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/impact-assessment')
  assessImpact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssessChangeImpactDto,
    @Req() req: Request,
  ) {
    return this.changeControlService.assessImpact(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/approval')
  recordApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordChangeApprovalDto,
    @Req() req: Request,
  ) {
    return this.changeControlService.recordApproval(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/implementation')
  recordImplementation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordChangeImplementationDto,
    @Req() req: Request,
  ) {
    return this.changeControlService.recordImplementation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_registrations')
  @Post(':id/open-linked-variation')
  openLinkedVariation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenLinkedVariationDto,
    @Req() req: Request,
  ) {
    return this.changeControlService.openLinkedVariation(user, id, dto, { ip: req.ip })
  }
}
