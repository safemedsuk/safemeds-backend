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
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import { CreateRegulatoryInspectionResponseDto } from './dto/create-regulatory-inspection-response.dto'
import { RegulatoryInspectionResponseService } from './regulatory-inspection-response.service'


@ApiTags('internal-audits')
@Controller('internal-audits/:auditId/regulatory-responses')
@RequirePermissions('quality.view_all')
export class RegulatoryInspectionResponseController {
  constructor(private readonly service: RegulatoryInspectionResponseService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('auditId') auditId: string) {
    return this.service.list(actor, auditId)
  }

  @RequirePermissions('quality.manage_capa')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId') auditId: string,
    @Body() dto: CreateRegulatoryInspectionResponseDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, auditId, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/submit')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  submit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: false, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File | undefined,
    @Body('responseText') responseText: string,
    @Req() req: Request,
  ) {
    const uploadFile = file
      ? { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype }
      : null
    return this.service.submit(actor, id, responseText, uploadFile, { ip: req.ip })
  }
}
