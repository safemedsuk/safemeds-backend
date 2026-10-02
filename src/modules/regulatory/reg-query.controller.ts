import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Patch,
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
import { CloseRegQueryDto } from './dto/close-reg-query.dto'
import { CreateRegQueryDto } from './dto/create-reg-query.dto'
import { ListRegQueriesQueryDto } from './dto/list-reg-queries-query.dto'
import { LogRegQueryCorrespondenceDto } from './dto/log-reg-query-correspondence.dto'
import { AssignRegQueryOwnerDto, UpdateRegQueryDueDateDto } from './dto/update-reg-query.dto'
import { RegQueryService } from './reg-query.service'


/**
 * CEO feedback, 30 Sep 2026 — the cross-dossier query register: "all
 * queries across products and markets, filterable by market, product,
 * owner and status, with overdue queries highlighted." Deliberately a
 * separate top-level controller/route from `RegQueryController` below
 * (which stays scoped to one dossier's own correspondence panel) — a
 * register view has no single dossier to nest under.
 */
@ApiTags('reg-queries')
@Controller('reg-queries')
@RequirePermissions('regulatory.view_all')
export class RegQueryRegisterController {
  constructor(private readonly regQueryService: RegQueryService) {}

  @Get()
  registerList(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRegQueriesQueryDto) {
    return this.regQueryService.registerList(actor, query)
  }
}

@ApiTags('reg-queries')
@Controller('reg-dossiers/:dossierId/queries')
@RequirePermissions('regulatory.view_all')
export class RegQueryController {
  constructor(private readonly regQueryService: RegQueryService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('dossierId') dossierId: string) {
    return this.regQueryService.list(actor, dossierId)
  }

  /** testing-correction-explanation.md §2.1 — the regulator's own query letter is now a mandatory upload alongside `queryText`/`receivedDate`, in the same `multipart/form-data` request. */
  @RequirePermissions('regulatory.manage_dossier')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  receive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Body() dto: CreateRegQueryDto,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.regQueryService.receive(
      actor,
      dossierId,
      dto,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }

  /** CEO feedback, 30 Sep 2026 — set/correct the regulator's own stated deadline at any point in the query's life. */
  @RequirePermissions('regulatory.manage_dossier')
  @Patch(':queryId/due-date')
  setDueDate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @Body() dto: UpdateRegQueryDueDateDto,
    @Req() req: Request,
  ) {
    return this.regQueryService.updateDueDate(actor, dossierId, queryId, dto, { ip: req.ip })
  }

  /** CEO feedback, 30 Sep 2026 — "assign each query to a named person, with the option to reassign." */
  @RequirePermissions('regulatory.manage_dossier')
  @Patch(':queryId/owner')
  assignOwner(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @Body() dto: AssignRegQueryOwnerDto,
    @Req() req: Request,
  ) {
    return this.regQueryService.assignOwner(actor, dossierId, queryId, dto, { ip: req.ip })
  }

  @Get(':queryId/correspondence')
  listCorrespondence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
  ) {
    return this.regQueryService.listCorrespondence(actor, dossierId, queryId)
  }

  /** CEO feedback, 30 Sep 2026 — "every letter, email and document exchanged on a query kept in one thread." `file` is optional at the HTTP layer — a phone call/internal note legitimately has no document. */
  @RequirePermissions('regulatory.manage_dossier')
  @Post(':queryId/correspondence')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  addCorrespondence(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @Body() dto: LogRegQueryCorrespondenceDto,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: false, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    const uploadFile = file
      ? { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype }
      : null
    return this.regQueryService.addCorrespondence(actor, dossierId, queryId, dto, uploadFile, {
      ip: req.ip,
    })
  }

  /**
   * `file` is optional at the HTTP layer only (`fileIsRequired: false`) —
   * RegCloud Stage 15's `client_handles_queries` engagement type is the
   * one legitimate exception with no document to share;
   * `RegQueryService.respond()` itself enforces exactly which is required
   * for a given dossier's effective engagement type. `note` and `respondedDate`
   * are always required, regardless of engagement type.
   */
  @RequirePermissions('regulatory.manage_dossier')
  @Post(':queryId/respond')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  respond(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: false, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File | undefined,
    @Body('note') note: string,
    @Body('respondedDate') respondedDate: string,
    @Req() req: Request,
  ) {
    const uploadFile = file
      ? { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype }
      : null
    return this.regQueryService.respond(
      actor,
      dossierId,
      queryId,
      uploadFile,
      note,
      respondedDate,
      { ip: req.ip },
    )
  }

  /** CEO feedback, 30 Sep 2026 — the register's own separate, deliberate "closed" state, reachable only once a response is on file. */
  @RequirePermissions('regulatory.manage_dossier')
  @Post(':queryId/close')
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('dossierId') dossierId: string,
    @Param('queryId') queryId: string,
    @Body() dto: CloseRegQueryDto,
    @Req() req: Request,
  ) {
    return this.regQueryService.close(actor, dossierId, queryId, dto, { ip: req.ip })
  }
}
