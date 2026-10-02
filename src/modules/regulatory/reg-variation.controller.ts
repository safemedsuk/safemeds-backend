import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
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
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import { CreateRegVariationDto } from './dto/create-reg-variation.dto'
import { RegVariationService } from './reg-variation.service'


@ApiTags('reg-variations')
@Controller('reg-variations')
@RequirePermissions('regulatory.view_all')
export class RegVariationController {
  constructor(private readonly regVariationService: RegVariationService) {}

  /** testing-correction-explanation.md §2.2 — omit `productRegistrationId` for the company-wide "All Variations" list; pass it to scope to one registration's own history, exactly as before. */
  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('productRegistrationId') productRegistrationId?: string,
  ) {
    return productRegistrationId
      ? this.regVariationService.list(actor, productRegistrationId)
      : this.regVariationService.listAllForCompany(actor)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.regVariationService.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_variations')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegVariationDto,
    @Req() req: Request,
  ) {
    return this.regVariationService.create(actor, dto, { ip: req.ip })
  }

  /** testing-correction-explanation.md §2.2 — one of the two named documents required, alongside ≥1 accompanying-change document, before a variation can leave `variation_application`. */
  @RequirePermissions('regulatory.manage_variations')
  @Post(':id/payment-proof')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachPaymentProof(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.regVariationService.attachPaymentProof(
      actor,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  @RequirePermissions('regulatory.manage_variations')
  @Post(':id/invoice')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachInvoice(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.regVariationService.attachInvoice(
      actor,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
