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
import { DocumentsService } from './documents.service'
import { CreateDocumentUploadDto } from './dto/create-document-upload.dto'
import { DirectUploadDto } from './dto/direct-upload.dto'

// Matches `UPLOAD_MAX_FILE_SIZE_MB`'s default (10) — `multer`'s own limit
// option needs a plain number at decorator-evaluation time, before DI/
// ConfigService exist, same constraint the pre-existing licence-upload
// endpoint already works around the same way. `DocumentsService.uploadDirect()`
// re-checks against the real configured value once it does have
// ConfigService, so a non-default env value is still enforced correctly —
// this is just the outer, slightly-generous multer-level backstop.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @RequirePermissions('documents.view')
  @Get('records/:type/:id/documents')
  listForRecord(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.documentsService.listForRecord(user, type, id)
  }

  /**
   * The server-proxied upload path (see `DocumentsService`'s own doc
   * comment) — this is what every real frontend screen calls today, since
   * the presigned-URL/browser-to-R2 path below needs R2 bucket CORS
   * configuration this environment doesn't have yet.
   */
  @RequirePermissions('documents.manage')
  @Post('records/:type/:id/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadDirect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Body() dto: DirectUploadDto,
    @Req() req: Request,
  ) {
    return this.documentsService.uploadDirect(
      user,
      type,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { documentId: dto.documentId, title: dto.title },
      { ip: req.ip },
    )
  }

  @RequirePermissions('documents.manage')
  @Post('records/:type/:id/documents')
  createUploadIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: CreateDocumentUploadDto,
    @Req() req: Request,
  ) {
    return this.documentsService.createUploadIntent(user, type, id, dto, { ip: req.ip })
  }

  @RequirePermissions('documents.manage')
  @Post('documents/:id/versions/:vId/complete')
  completeUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('vId') vId: string,
    @Req() req: Request,
  ) {
    return this.documentsService.completeUpload(user, id, vId, { ip: req.ip })
  }

  @RequirePermissions('documents.view')
  @Get('documents/:id/versions/:vId/download')
  getDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('vId') vId: string,
  ) {
    return this.documentsService.getDownloadUrl(user, id, vId)
  }
}
