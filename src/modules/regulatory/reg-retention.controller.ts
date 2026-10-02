import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common'
import { FileFieldsInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import { CreateRegRetentionDto } from './dto/create-reg-retention.dto'
import { RegRetentionService } from './reg-retention.service'


/** testing-correction-explanation.md §3.3 — two named files in one request (invoice + proof of payment), the same real-world action as "log this year's retention." */
@ApiTags('reg-retentions')
@Controller('reg-retentions')
@RequirePermissions('regulatory.view_all')
export class RegRetentionController {
  constructor(private readonly regRetentionService: RegRetentionService) {}

  /** Omit `productRegistrationId` for the company-wide "All Retentions" list; pass it to scope to one registration's own history. */
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('productRegistrationId') productRegistrationId?: string,
  ) {
    return productRegistrationId
      ? this.regRetentionService.list(actor, productRegistrationId)
      : this.regRetentionService.listAllForCompany(actor)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.regRetentionService.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_retentions')
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'invoice', maxCount: 1 },
        { name: 'proofOfPayment', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } },
    ),
  )
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegRetentionDto,
    @UploadedFiles()
    files: { invoice?: Express.Multer.File[]; proofOfPayment?: Express.Multer.File[] },
    @Req() req: Request,
  ) {
    const invoice = files.invoice?.[0]
    const proofOfPayment = files.proofOfPayment?.[0]
    if (!invoice || !proofOfPayment) {
      throw new BadRequestException({
        code: 'RETENTION_DOCUMENTS_REQUIRED',
        message: 'Both the invoice and proof of payment are required to log a retention.',
      })
    }
    return this.regRetentionService.create(
      actor,
      dto,
      { buffer: invoice.buffer, originalname: invoice.originalname, mimetype: invoice.mimetype },
      {
        buffer: proofOfPayment.buffer,
        originalname: proofOfPayment.originalname,
        mimetype: proofOfPayment.mimetype,
      },
      { ip: req.ip },
    )
  }
}
