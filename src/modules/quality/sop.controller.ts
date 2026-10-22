import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateSopDto } from './dto/create-sop.dto'
import { ListSopsQueryDto } from './dto/list-sops-query.dto'
import { UpdateSopDto } from './dto/update-sop.dto'
import { SopService } from './sop.service'

@ApiTags('quality-controlled-documents')
@Controller('quality/sops')
export class SopController {
  constructor(private readonly sopService: SopService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSopsQueryDto) {
    return this.sopService.list(user, query)
  }

  /**
   * Pass A: the minimal, name-only active-user list a document owner needs
   * to assign readers. Deliberately NOT `GET /users` (gated `users.view`,
   * which a QUALITY_ASSOCIATE correctly does not hold). Gated on the same
   * permission as assigning readers, so anyone who can assign can see who
   * they may assign to, and nobody else.
   */
  @RequirePermissions('quality.manage_documents')
  @Get('assignable-readers')
  assignableReaders(@CurrentUser() user: AuthenticatedUser) {
    return this.sopService.listAssignableReaders(user)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sopService.get(user, id)
  }

  @RequirePermissions('quality.manage_documents')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSopDto, @Req() req: Request) {
    return this.sopService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_documents')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSopDto,
    @Req() req: Request,
  ) {
    return this.sopService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_documents')
  @Post(':id/revise')
  reviseNewVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.sopService.reviseNewVersion(user, id, { ip: req.ip })
  }
}
