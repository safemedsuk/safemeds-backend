import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AssemblePqrDto, ReviewPqrDto } from './dto/pqr.dto'
import { PqrService } from './pqr.service'

@ApiTags('quality-pqr')
@Controller('quality/pqr')
export class PqrController {
  constructor(private readonly service: PqrService) {}

  @RequirePermissions('quality.view_pqr')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId?: string) {
    return this.service.list(user, productId)
  }

  @RequirePermissions('quality.view_pqr')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user, id)
  }

  @RequirePermissions('quality.view_pqr')
  @Post('assemble')
  assemble(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssemblePqrDto,
    @Req() req: Request,
  ) {
    return this.service.assemble(user, dto, { ip: req.ip })
  }

  /** Short-lived link to the archived PDF or Excel file of a signed APQR. */
  @RequirePermissions('quality.view_pqr')
  @Get(':id/download')
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Req() req: Request,
  ) {
    if (format !== 'pdf' && format !== 'xlsx') {
      throw new BadRequestException({
        code: 'FORMAT_INVALID',
        message: 'format must be pdf or xlsx',
      })
    }
    return this.service.download(user, id, format, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_pqr')
  @Post(':id/review')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewPqrDto,
    @Req() req: Request,
  ) {
    return this.service.review(user, id, dto, { ip: req.ip })
  }
}
