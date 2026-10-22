import { Body, Controller, Get, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DocumentNumberingService } from './document-numbering.service'
import { SaveDocumentNumberingDto } from './dto/document-numbering.dto'
import { SEVERITY_DEFINITIONS } from './severity-definitions.const'

@ApiTags('quality-config')
@Controller('quality/config')
export class QualityConfigController {
  constructor(private readonly documentNumbering: DocumentNumberingService) {}

  @RequirePermissions('quality.view_all')
  @Get('severity-definitions')
  getSeverityDefinitions() {
    return SEVERITY_DEFINITIONS
  }

  @RequirePermissions('quality.view_all')
  @Get('document-numbering')
  getDocumentNumbering(@CurrentUser() user: AuthenticatedUser) {
    return this.documentNumbering.getConfig(user)
  }

  /** Company administrators only; every save is audited with old and new values. */
  @RequirePermissions('company_profile.manage')
  @Put('document-numbering')
  saveDocumentNumbering(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveDocumentNumberingDto,
    @Req() req: Request,
  ) {
    return this.documentNumbering.saveConfig(user, dto, { ip: req.ip })
  }
}
