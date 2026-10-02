import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRegulatoryAuthorityDto } from './dto/create-regulatory-authority.dto'
import { UpdateRegulatoryAuthorityDto } from './dto/update-regulatory-authority.dto'
import { RegulatoryAuthoritiesService } from './regulatory-authorities.service'

// Matches the emblem's own 2MB service-level cap — see that gotcha's
// twin, `documents.controller.ts`'s `MAX_UPLOAD_BYTES`, for why this is
// a plain number literal rather than reading `ConfigService` here.
const MAX_EMBLEM_UPLOAD_BYTES = 2 * 1024 * 1024

@ApiTags('regulatory-authorities')
@Controller('regulatory-authorities')
export class RegulatoryAuthoritiesController {
  constructor(private readonly service: RegulatoryAuthoritiesService) {}

  /** Open to any authenticated user — catalog metadata, same treatment as `GET /country-config/*`. `countryId` may repeat (`?countryId=A&countryId=B`) to scope to several operating markets at once — see `RegulatoryAuthoritiesService.list()`'s own doc comment. */
  @Get()
  list(@Query('countryId') countryId?: string | string[]) {
    return this.service.list(countryId)
  }

  /** Open read — lets the admin UI's emblem picker show only real, selectable keys. */
  @Get('emblem-assets')
  listEmblemAssets() {
    return this.service.getAvailableEmblemAssetKeys()
  }

  @RequirePermissions('platform.config.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegulatoryAuthorityDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRegulatoryAuthorityDto,
    @Req() req: Request,
  ) {
    return this.service.update(actor, id, dto, { ip: req.ip })
  }

  /** Real-usage feedback, 19 Aug 2026 — the per-authority admin-upload path replacing "bundled assets only." */
  @RequirePermissions('platform.config.manage')
  @Post(':id/emblem')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_EMBLEM_UPLOAD_BYTES },
    }),
  )
  uploadEmblem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.service.uploadEmblem(
      actor,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  @RequirePermissions('platform.config.manage')
  @Post(':id/emblem/remove')
  removeEmblem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.removeEmblem(actor, id, { ip: req.ip })
  }
}
