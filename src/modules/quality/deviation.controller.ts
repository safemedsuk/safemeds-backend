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
import { DeviationService } from './deviation.service'
import { CreateDeviationDto } from './dto/create-deviation.dto'
import { ListDeviationsQueryDto } from './dto/list-deviations-query.dto'
import { OpenCapaForDeviationDto } from './dto/open-capa-for-deviation.dto'
import { RecordInvestigationDto } from './dto/record-investigation.dto'

@ApiTags('quality-deviations')
@Controller('quality/deviations')
export class DeviationController {
  constructor(private readonly deviationService: DeviationService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDeviationsQueryDto) {
    return this.deviationService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.deviationService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDeviationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/investigation')
  recordInvestigation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordInvestigationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.recordInvestigation(user, id, dto, { ip: req.ip })
  }

  /** Pass A2 (item 4a/4c) — investigation evidence (any supporting record). */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/investigation/evidence')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadInvestigationEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.deviationService.uploadInvestigationDocument(
      user,
      id,
      'evidence',
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** Pass A2 (item 4c) — the investigation report, required before the investigation can be completed. */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/investigation/report')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadInvestigationReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.deviationService.uploadInvestigationDocument(
      user,
      id,
      'report',
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/capa')
  openCapaForDeviation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCapaForDeviationDto,
    @Req() req: Request,
  ) {
    return this.deviationService.openCapaForDeviation(user, id, dto, { ip: req.ip })
  }
}
