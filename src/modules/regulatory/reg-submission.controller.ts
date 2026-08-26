import {
  Controller,
  Get,
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
import { RegSubmissionService } from './reg-submission.service'

/** Matches `DocumentsController`'s own outer multer limit — see that class's doc comment for why this is a plain number and why `DocumentsService.uploadDirect()`'s own re-check is what actually enforces a non-default limit. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

@ApiTags('reg-submissions')
@Controller('reg-dossiers/:dossierId/submissions')
@RequirePermissions('regulatory.view_all')
export class RegSubmissionController {
  constructor(private readonly regSubmissionService: RegSubmissionService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('dossierId') dossierId: string) {
    return this.regSubmissionService.list(actor, dossierId)
  }

  @RequirePermissions('regulatory.submit')
  @Post()
  generate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Req() req: Request,
  ) {
    return this.regSubmissionService.generate(actor, dossierId, { ip: req.ip })
  }

  /** The "actually dispatched it (courier/portal/email) outside this system, here's proof" step — the real evidence `RegWorkflowGuards`' own gate on `completeness_check → submitted` checks for. */
  @RequirePermissions('regulatory.submit')
  @Post(':submissionId/evidence')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachEvidence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('submissionId') submissionId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.regSubmissionService.attachEvidence(
      actor,
      submissionId,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
