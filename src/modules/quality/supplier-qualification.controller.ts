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
  UseInterceptors,
} from '@nestjs/common'
import { ParseFilePipeBuilder } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { memoryStorage } from 'multer'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { MAX_UPLOAD_BYTES } from '../../common/upload-limits.const'
import {
  ApproveSupplierDto,
  AssessSupplierDto,
  CreateCoaDto,
  MonitorSupplierDto,
  ReviewCoaDto,
  ScheduleSupplierAuditDto,
} from './dto/supplier-qualification.dto'
import { SupplierQualificationService } from './supplier-qualification.service'

/**
 * Deliberately a distinct path prefix (`quality/supplier-qualification`,
 * not `quality/suppliers`) — `SupplierController` (Stage 0.1) already
 * owns `quality/suppliers/:id` with a bare-UUID wildcard segment; a
 * second controller registering a static route under the exact same
 * prefix (e.g. `.../approved-list`) risks that wildcard shadowing it
 * depending on controller registration order. Keeping this service's
 * own routes on a clearly-named sibling prefix avoids the ambiguity
 * entirely rather than depending on registration-order correctness.
 */
@ApiTags('quality-suppliers')
@Controller('quality/supplier-qualification')
export class SupplierQualificationController {
  constructor(private readonly service: SupplierQualificationService) {}

  @RequirePermissions('quality.view_all')
  @Get('approved-list')
  listApproved(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listApproved(user)
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/assess')
  assess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssessSupplierDto,
    @Req() req: Request,
  ) {
    return this.service.assess(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get(':id/questionnaires')
  listQuestionnaires(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listQuestionnaires(user, id)
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/schedule-audit')
  scheduleAudit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleSupplierAuditDto,
    @Req() req: Request,
  ) {
    return this.service.scheduleAudit(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.approve_suppliers')
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveSupplierDto,
    @Req() req: Request,
  ) {
    return this.service.approve(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/monitor')
  monitor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MonitorSupplierDto,
    @Req() req: Request,
  ) {
    return this.service.monitor(user, id, dto, { ip: req.ip })
  }

  /** Pass B (item D1) — uploads the supplier's GMP certificate; `approve()` requires it. */
  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/gmp-certificate')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachGmpCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.service.attachGmpCertificate(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** Pass B (item D2) — uploads a biennial review checklist; returns its id for `POST .../monitor`. */
  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/review-checklist')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadReviewChecklist(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file)
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choose a checklist file' })
    return this.service.uploadReviewChecklist(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** Pass B (item D2/D3) — the biennial review history, newest first, each with its checklist document. */
  @RequirePermissions('quality.view_all')
  @Get(':id/reviews')
  listReviews(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.listReviews(user, id)
  }
}

@ApiTags('quality-coa')
@Controller('quality/certificates-of-analysis')
export class CertificateOfAnalysisController {
  constructor(private readonly service: SupplierQualificationService) {}

  @RequirePermissions('quality.manage_suppliers')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCoaDto, @Req() req: Request) {
    return this.service.createCoa(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('supplierId') supplierId?: string) {
    return this.service.listCoa(user, supplierId)
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/review')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewCoaDto,
    @Req() req: Request,
  ) {
    return this.service.reviewCoa(user, id, dto, { ip: req.ip })
  }
}
