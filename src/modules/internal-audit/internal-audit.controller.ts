import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { CreateAuditFindingDto } from './dto/create-audit-finding.dto'
import { CreateInternalAuditDto } from './dto/create-internal-audit.dto'
import { UpdateInternalAuditDto } from './dto/update-internal-audit.dto'
import { InternalAuditService } from './internal-audit.service'

@ApiTags('internal-audits')
@Controller('internal-audits')
export class InternalAuditController {
  constructor(private readonly internalAuditService: InternalAuditService) {}

  @RequirePermissions('quality.manage_capa')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInternalAuditDto,
    @Req() req: Request,
  ) {
    return this.internalAuditService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.internalAuditService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get('findings')
  listFindings(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.internalAuditService.listFindings(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.internalAuditService.get(user, id)
  }

  @RequirePermissions('quality.manage_capa')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInternalAuditDto,
    @Req() req: Request,
  ) {
    return this.internalAuditService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/findings')
  addFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateAuditFindingDto,
    @Req() req: Request,
  ) {
    return this.internalAuditService.addFinding(user, id, dto, { ip: req.ip })
  }
}
