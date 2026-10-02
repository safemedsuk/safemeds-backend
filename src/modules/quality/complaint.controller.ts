import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ComplaintService } from './complaint.service'
import { ClassifyComplaintDto } from './dto/classify-complaint.dto'
import { CreateComplaintDto } from './dto/create-complaint.dto'
import { ListComplaintsQueryDto } from './dto/list-complaints-query.dto'
import { OpenCapaForComplaintDto } from './dto/open-capa-for-complaint.dto'
import { ResolveComplaintDto } from './dto/resolve-complaint.dto'

@ApiTags('quality-complaints')
@Controller('quality/complaints')
export class ComplaintController {
  constructor(private readonly complaintService: ComplaintService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListComplaintsQueryDto) {
    return this.complaintService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get('resolution-time-kpi')
  resolutionTimeKpi(@CurrentUser() user: AuthenticatedUser) {
    return this.complaintService.resolutionTimeKpi(user)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.complaintService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/classify')
  classify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ClassifyComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.classify(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.resolve(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/capa')
  openCapaForComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCapaForComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintService.openCapaForComplaint(user, id, dto, { ip: req.ip })
  }
}
