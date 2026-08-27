import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateGeneratedReportDto } from './dto/create-generated-report.dto'
import { ListGeneratedReportsQueryDto } from './dto/list-generated-reports-query.dto'
import { ReportsService } from './reports.service'

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @RequirePermissions('reports.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGeneratedReportsQueryDto) {
    return this.reportsService.list(user, query)
  }

  @RequirePermissions('reports.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reportsService.get(user, id)
  }

  @RequirePermissions('reports.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGeneratedReportDto,
    @Req() req: Request,
  ) {
    return this.reportsService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('reports.manage')
  @Post(':id/finalize')
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportsService.finalize(user, id, { ip: req.ip })
  }

  @RequirePermissions('reports.manage')
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportsService.submit(user, id, { ip: req.ip })
  }
}
