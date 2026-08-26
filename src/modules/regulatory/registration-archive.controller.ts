import { Controller, Get, Param, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegistrationArchiveService } from './registration-archive.service'

@ApiTags('registration-archive')
@Controller('product-registrations/:id/archive')
@RequirePermissions('regulatory.view_all')
export class RegistrationArchiveController {
  constructor(private readonly service: RegistrationArchiveService) {}

  @Get()
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.getArchive(actor, id)
  }

  @Get('export.csv')
  async exportCsv(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const csv = await this.service.exportCsv(actor, id)
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="registration-${id}-archive.csv"`)
    res.send(csv)
  }
}
