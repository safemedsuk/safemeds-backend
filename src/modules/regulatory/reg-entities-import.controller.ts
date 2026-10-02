import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RegEntitiesImportCommitDto, RegEntitiesImportPreviewDto } from './dto/reg-entities-import.dto'
import { RegEntitiesImportService } from './reg-entities-import.service'

/**
 * testing-correction-explanation.md §4.1 — a dedicated pair of endpoints,
 * separate from `/bulk-import/:importType/...`, since this import spans
 * up to 3 files with a real cross-file relational link (see
 * `RegEntitiesImportService`'s own doc comment). Gated by the exact same
 * `regulatory.manage_entities` permission the manual create endpoints on
 * `RegEntitiesController` already use — this is the same action at
 * batch scale, not a different privilege.
 */
@ApiTags('regulatory-entities-import')
@Controller('reg-entities-import')
@RequirePermissions('regulatory.manage_entities')
export class RegEntitiesImportController {
  constructor(private readonly regEntitiesImportService: RegEntitiesImportService) {}

  @Post('preview')
  preview(@CurrentUser() actor: AuthenticatedUser, @Body() dto: RegEntitiesImportPreviewDto) {
    return this.regEntitiesImportService.preview(actor, dto)
  }

  @Post('commit')
  commit(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RegEntitiesImportCommitDto,
    @Req() req: Request,
  ) {
    return this.regEntitiesImportService.commit(actor, dto, { ip: req.ip })
  }
}
