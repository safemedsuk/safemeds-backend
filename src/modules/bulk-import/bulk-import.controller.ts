import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BulkImportService } from './bulk-import.service'
import { CommitBulkImportDto } from './dto/commit-bulk-import.dto'
import { PreviewBulkImportDto } from './dto/preview-bulk-import.dto'

/**
 * `:importType` resolves to whichever `Importer` is registered under that
 * key (`user_invite`, Stage 2's `product`, ...) — each declares its own
 * `requiredPermission` (`users.invite`, `master_data.manage`, ...),
 * checked by `BulkImportService` itself once it resolves the importer,
 * since a static per-controller-class `@RequirePermissions()` can't vary
 * by route param. Every route here still requires a real, authenticated
 * actor (the global `JwtAuthGuard` applies regardless — nothing in this
 * controller is `@Public()`); it's specifically *which* permission that's
 * resolved dynamically.
 */
@ApiTags('bulk-import')
@Controller('bulk-import/:importType')
export class BulkImportController {
  constructor(private readonly bulkImportService: BulkImportService) {}

  @Post('preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importType') importType: string,
    @Body() dto: PreviewBulkImportDto,
  ) {
    return this.bulkImportService.preview(user, importType, dto.csvText)
  }

  @Post('commit')
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importType') importType: string,
    @Body() dto: CommitBulkImportDto,
    @Req() req: Request,
  ) {
    return this.bulkImportService.commit(user, importType, dto.rows, { ip: req.ip })
  }
}
