import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
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
import { CreateRegQueryDto } from './dto/create-reg-query.dto'
import { RegQueryService } from './reg-query.service'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

@ApiTags('reg-queries')
@Controller('reg-dossiers/:dossierId/queries')
@RequirePermissions('regulatory.view_all')
export class RegQueryController {
  constructor(private readonly regQueryService: RegQueryService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('dossierId') dossierId: string) {
    return this.regQueryService.list(actor, dossierId)
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post()
  receive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Body() dto: CreateRegQueryDto,
    @Req() req: Request,
  ) {
    return this.regQueryService.receive(actor, dossierId, dto, { ip: req.ip })
  }

  /**
   * `file` is optional at the HTTP layer too (`fileIsRequired: false`) —
   * RegCloud Stage 15's `client_handles_queries` engagement type responds
   * with a `note` form field instead; `RegQueryService.respond()` itself
   * enforces exactly which is required for a given dossier's effective
   * engagement type.
   */
  @RequirePermissions('regulatory.manage_dossier')
  @Post(':queryId/respond')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  respond(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: false, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File | undefined,
    @Body('note') note: string | undefined,
    @Req() req: Request,
  ) {
    const uploadFile = file
      ? { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype }
      : null
    return this.regQueryService.respond(actor, dossierId, queryId, uploadFile, note, { ip: req.ip })
  }
}
