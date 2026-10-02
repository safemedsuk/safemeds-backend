import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRecallDto } from './dto/create-recall.dto'
import { LinkRecallCasesDto } from './dto/link-recall-cases.dto'
import { ListRecallsQueryDto } from './dto/list-recalls-query.dto'
import { OpenRecallInvestigationCapaDto } from './dto/open-recall-investigation-capa.dto'
import { RecallService } from './recall.service'

@ApiTags('recalls')
@Controller('recalls')
@RequirePermissions('regulatory.view_all')
export class RecallController {
  constructor(private readonly service: RecallService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRecallsQueryDto) {
    return this.service.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(actor, id)
  }

  // QualCloud (Phase 13) Stage 10.8's own mapping: RECALL.CREATE/EDIT ->
  // QUALITY_ASSOCIATE (drafts/logs, matching that role's established
  // "logs, doesn't approve" stance) — `quality.log_recall`, also held
  // by QUALITY_MANAGER and (preserving this controller's own
  // pre-existing behavior) REGULATORY_AFFAIRS_OFFICER. Deliberately
  // distinct from `regulatory.manage_recalls`, which now gates only
  // the regulator-submission half (SUBMISSION.GENERATE), a materially
  // different action this same spec assigns to a different persona.
  @RequirePermissions('quality.log_recall')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRecallDto,
    @Req() req: Request,
  ) {
    return this.service.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.log_recall')
  @Post(':id/link-cases')
  linkCases(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkRecallCasesDto,
    @Req() req: Request,
  ) {
    return this.service.linkCases(actor, id, dto.caseIds, { ip: req.ip })
  }

  /** QualCloud (Phase 13) Stage 10.6 — Closure Gate #6, reuses the real `quality.manage_capa` permission (the same one every other "open a CAPA" action in this codebase is gated by), not a recall-specific one. */
  @RequirePermissions('quality.manage_capa')
  @Post(':id/investigation-capa')
  openInvestigationCapa(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenRecallInvestigationCapaDto,
    @Req() req: Request,
  ) {
    return this.service.openInvestigationCapa(actor, id, dto, { ip: req.ip })
  }
}
