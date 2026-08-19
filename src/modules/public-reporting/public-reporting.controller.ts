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
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { Public } from '../../common/decorators/public.decorator'
import { SubmitPublicReportDto } from './dto/submit-public-report.dto'
import { PublicReportingService } from './public-reporting.service'

// Same outer multer-level backstop as `DocumentsController`'s own
// `MAX_UPLOAD_BYTES` — see that file's doc comment for why this can't
// just read `UPLOAD_MAX_FILE_SIZE_MB` directly at decorator-evaluation time.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * VigiCloud Stage 3.2 — fully unauthenticated, per-company public
 * case-reporting endpoints. Throttled meaningfully harder than a normal
 * public endpoint (`InvitationPublicController`'s busiest route is 10/min)
 * since this is genuinely open to the internet with no account behind it
 * at all — a real spam/abuse target.
 */
@ApiTags('public-reporting')
@Controller('report')
export class PublicReportingController {
  constructor(private readonly publicReportingService: PublicReportingService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':slug')
  resolve(@Param('slug') slug: string) {
    return this.publicReportingService.resolveCompanyDisplay(slug)
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':slug')
  submit(@Param('slug') slug: string, @Body() dto: SubmitPublicReportDto, @Req() req: Request) {
    return this.publicReportingService.submit(slug, dto, { ip: req.ip })
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':slug/products')
  searchProducts(@Param('slug') slug: string, @Query('q') q: string) {
    return this.publicReportingService.searchProducts(slug, q)
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':slug/:referenceNumber/document')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachSourceDocument(
    @Param('slug') slug: string,
    @Param('referenceNumber') referenceNumber: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.publicReportingService.attachSourceDocument(
      slug,
      referenceNumber,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
