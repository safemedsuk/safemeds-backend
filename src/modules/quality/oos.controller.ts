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
import { CreateOosDto } from './dto/create-oos.dto'
import { ListOosQueryDto } from './dto/list-oos-query.dto'
import { OpenCapaForOosDto } from './dto/open-capa-for-oos.dto'
import { RecordOosFindingDto } from './dto/record-oos-finding.dto'
import { RecordOosPhase1Dto } from './dto/record-oos-phase1.dto'
import { RecordOosPhase2Dto } from './dto/record-oos-phase2.dto'
import { RecordOosRetestDto } from './dto/record-oos-retest.dto'
import { OosService } from './oos.service'

@ApiTags('quality-oos')
@Controller('quality/oos')
export class OosController {
  constructor(private readonly oosService: OosService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOosQueryDto) {
    return this.oosService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.oosService.get(user, id)
  }

  @RequirePermissions('quality.log_deviation')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOosDto, @Req() req: Request) {
    return this.oosService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/phase1')
  recordPhase1(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordOosPhase1Dto,
    @Req() req: Request,
  ) {
    return this.oosService.recordPhase1(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/retest')
  recordRetest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordOosRetestDto,
    @Req() req: Request,
  ) {
    return this.oosService.recordRetest(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_deviation')
  @Post(':id/phase2')
  recordPhase2(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordOosPhase2Dto,
    @Req() req: Request,
  ) {
    return this.oosService.recordPhase2(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/capa')
  openCapaForOos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenCapaForOosDto,
    @Req() req: Request,
  ) {
    return this.oosService.openCapaForOos(user, id, dto, { ip: req.ip })
  }

  /** Pass A2 (item 4b) — "Record finding": needs at least one attached document first. */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/finding')
  recordFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordOosFindingDto,
    @Req() req: Request,
  ) {
    return this.oosService.recordFinding(user, id, dto, { ip: req.ip })
  }

  /** Pass A2 (item 4b) — a finding's supporting document (test report etc.). */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/finding-documents')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadFindingDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.oosService.uploadOosDocument(
      user,
      id,
      'finding',
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** Pass A2 (item 4c) — the Phase 2 manufacturing investigation report. */
  @RequirePermissions('quality.log_deviation')
  @Post(':id/manufacturing-report')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadManufacturingReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.oosService.uploadOosDocument(
      user,
      id,
      'manufacturing_report',
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
