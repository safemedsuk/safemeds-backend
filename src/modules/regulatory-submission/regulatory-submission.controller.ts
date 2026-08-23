import {
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
import { RegulatorySubmissionService } from './regulatory-submission.service'

// Matches `DocumentsController`'s own outer multer limit — see that
// class's doc comment for why this is a plain number, not read from
// `ConfigService`, and why `DocumentsService.uploadDirect()`'s own
// re-check against the real configured value is what actually enforces
// a non-default limit.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * VigiCloud Stage 12 — case-scoped generate/list live on `PvCaseController`
 * (`/pv/cases/:id/regulatory-submissions`) exactly like Stage 10's
 * duplicate-reviews endpoints; this controller holds the two actions that
 * are scoped to a specific `RegulatorySubmission` id instead of a case id.
 */
@ApiTags('regulatory-submissions')
@Controller('pv/regulatory-submissions')
export class RegulatorySubmissionController {
  constructor(private readonly regulatorySubmissionService: RegulatorySubmissionService) {}

  /** `artifact` — `xml` | `pdf` | `evidence`. A presigned R2 GET URL, same mechanism `DocumentsService.getDownloadUrl()` already serves every other document download through. */
  @RequirePermissions('pv.view_all')
  @Get(':id/download-url')
  getDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('artifact') artifact: 'xml' | 'pdf' | 'evidence',
  ) {
    return this.regulatorySubmissionService.getDownloadUrl(user, id, artifact)
  }

  /**
   * The "actually uploaded it to VigiFlow/PvERS outside this system,
   * here's proof" step. Gated by `documents.manage` (the same permission
   * the pre-existing source-document/general upload flows already use) —
   * the actual authority to move the case's workflow to `Submitted` is
   * enforced separately, by the seeded transition's own `REGULATORY_AFFAIRS_OFFICER`
   * role requirement plus this stage's new evidence guard, not by this
   * endpoint's permission gate.
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
    return this.regulatorySubmissionService.attachEvidence(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
