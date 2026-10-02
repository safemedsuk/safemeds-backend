import {
  Body,
  Controller,
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
import { GeneratePeriodicReportDto } from './dto/generate-periodic-report.dto'
import { PeriodicReportService } from './periodic-report.service'


@ApiTags('periodic-reports')
@Controller('reporting/periodic-reports')
export class PeriodicReportController {
  constructor(private readonly periodicReportService: PeriodicReportService) {}

  @RequirePermissions('reports.manage')
  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GeneratePeriodicReportDto,
    @Req() req: Request,
  ) {
    return this.periodicReportService.generate(user, dto, { ip: req.ip })
  }

  /**
   * The "actually dispatched it (portal upload, email), here's proof"
   * step — see `PeriodicReportService.attachEvidence()`'s own doc
   * comment for why this is deliberately ungated by the workflow
   * engine itself. `documents.manage`, matching
   * `RegulatorySubmissionController.attachEvidence()`'s own precedent.
   */
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
    return this.periodicReportService.attachEvidence(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
