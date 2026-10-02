import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ConfirmFalsifiedProductReportDto } from './dto/confirm-falsified-product-report.dto'
import { CreateFalsifiedProductReportDto } from './dto/create-falsified-product-report.dto'
import { DismissFalsifiedProductReportDto } from './dto/dismiss-falsified-product-report.dto'
import { ListFalsifiedProductReportsQueryDto } from './dto/list-falsified-product-reports-query.dto'
import { FalsifiedProductReportService } from './falsified-product-report.service'

@ApiTags('quality-falsified-product-reports')
@Controller('quality/falsified-product-reports')
export class FalsifiedProductReportController {
  constructor(private readonly service: FalsifiedProductReportService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListFalsifiedProductReportsQueryDto) {
    return this.service.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @RequirePermissions('quality.manage_falsified_reports')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFalsifiedProductReportDto,
    @Req() req: Request,
  ) {
    return this.service.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_falsified_reports')
  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmFalsifiedProductReportDto,
    @Req() req: Request,
  ) {
    return this.service.confirm(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_falsified_reports')
  @Post(':id/dismiss')
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DismissFalsifiedProductReportDto,
    @Req() req: Request,
  ) {
    return this.service.dismiss(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_falsified_reports')
  @Post(':id/close')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.service.close(user, id, { ip: req.ip })
  }
}
