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
import { CreateGeneratedReportDto } from './dto/create-generated-report.dto'
import { ListGeneratedReportsQueryDto } from './dto/list-generated-reports-query.dto'
import { ReportsService } from './reports.service'


@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @RequirePermissions('reports.view')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListGeneratedReportsQueryDto) {
    return this.reportsService.list(user, query)
  }

  @RequirePermissions('reports.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reportsService.get(user, id)
  }

  @RequirePermissions('reports.manage')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGeneratedReportDto,
    @Req() req: Request,
  ) {
    return this.reportsService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('reports.manage')
  @Post(':id/finalize')
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportsService.finalize(user, id, { ip: req.ip })
  }

  @RequirePermissions('reports.manage')
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.reportsService.submit(user, id, { ip: req.ip })
  }

  /** Real-usage request, 22 Sep 2026 (item 22) — proof this report was actually submitted to the authority. Generic across every report type, per `ReportsService.attachEvidence()`'s own doc comment. */
  @RequirePermissions('documents.manage')
  @Post(':id/evidence')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.reportsService.attachEvidence(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
