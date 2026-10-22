import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common'
import { ParseFilePipeBuilder } from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import {
  AddWasteDestructionAttendeeDto,
  CreateWasteDisposalCaseDto,
  ListWasteDisposalCasesQueryDto,
  RecordWasteApplicationDto,
  RecordWasteDestructionDto,
  RecordWasteHandoverDto,
} from './dto/waste-disposal-case.dto'
import {
  EVIDENCE_KINDS,
  EvidenceKind,
  WasteDisposalCaseService,
} from './waste-disposal-case.service'

/** Pass B (item B) — the 7-step waste disposal case. Every route refuses an out-of-order step in the service, not here. */
@ApiTags('quality-waste-disposal-cases')
@Controller('quality/waste-disposal-cases')
export class WasteDisposalCaseController {
  constructor(private readonly caseService: WasteDisposalCaseService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListWasteDisposalCasesQueryDto) {
    return this.caseService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.caseService.get(user, id)
  }

  /** Step 1 — waste weighed. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWasteDisposalCaseDto,
    @Req() req: Request,
  ) {
    return this.caseService.create(user, dto, { ip: req.ip })
  }

  /** Step 2 — PPB application and statutory fee. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/application')
  recordApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordWasteApplicationDto,
    @Req() req: Request,
  ) {
    return this.caseService.recordApplication(user, id, dto, { ip: req.ip })
  }

  /**
   * Steps 3, 4 (certificate) and 6 — one evidence file per request, uploaded
   * and linked in the same call. `kind` is one of `invoice`, `payment_receipt`,
   * `handover_certificate`, `ppb_certificate`.
   */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/evidence/:kind')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException({
        code: 'UNKNOWN_EVIDENCE_KIND',
        message: `Evidence kind must be one of: ${EVIDENCE_KINDS.join(', ')}`,
      })
    }
    return this.caseService.attachEvidence(
      user,
      id,
      kind as EvidenceKind,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** Step 4 — disposal company and handover date. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/handover')
  recordHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordWasteHandoverDto,
    @Req() req: Request,
  ) {
    return this.caseService.recordHandover(user, id, dto, { ip: req.ip })
  }

  /** Step 4 — a user marks the disposal company's certificate as verified by PPB. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/handover/verify')
  verifyHandover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.caseService.verifyHandover(user, id, { ip: req.ip })
  }

  /** Step 5 — destruction date and location. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/destruction')
  recordDestruction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordWasteDestructionDto,
    @Req() req: Request,
  ) {
    return this.caseService.recordDestruction(user, id, dto, { ip: req.ip })
  }

  /** Step 5 — add a person present at destruction. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/destruction/attendees')
  addAttendee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddWasteDestructionAttendeeDto,
    @Req() req: Request,
  ) {
    return this.caseService.addAttendee(user, id, dto, { ip: req.ip })
  }

  /** Step 5 — withdraw an attendee entered by mistake (never deleted). */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/destruction/attendees/:attendeeId/withdraw')
  withdrawAttendee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Req() req: Request,
  ) {
    return this.caseService.withdrawAttendee(user, id, attendeeId, { ip: req.ip })
  }

  /** Step 5 — upload destruction photos (JPEG/PNG); they are kept individually and combined into ONE PDF. */
  @RequirePermissions('quality.manage_waste_disposal')
  @Post(':id/destruction/photos')
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  addDestructionPhotos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    return this.caseService.addDestructionPhotos(
      user,
      id,
      (files ?? []).map((f) => ({
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
      })),
      { ip: req.ip },
    )
  }

  /** Step 7 — closure. Manager-level: requires `quality.close_waste_disposal`, held by QUALITY_MANAGER only. */
  @RequirePermissions('quality.close_waste_disposal')
  @Post(':id/close')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.caseService.close(user, id, { ip: req.ip })
  }
}
