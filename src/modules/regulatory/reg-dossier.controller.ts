import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ClassificationService } from './classification.service'
import { CompletenessGateService } from './completeness-gate.service'
import { AttachDossierDocumentDto } from './dto/attach-dossier-document.dto'
import { ClassifyQueryDto } from './dto/classify-query.dto'
import { CreateDossierSlotDto } from './dto/create-dossier-slot.dto'
import { CreateRegDossierDto } from './dto/create-reg-dossier.dto'
import { ListRegDossiersQueryDto } from './dto/list-reg-dossiers-query.dto'
import { RegDossierService } from './reg-dossier.service'

@ApiTags('reg-dossiers')
@Controller('reg-dossiers')
@RequirePermissions('regulatory.view_all')
export class RegDossierController {
  constructor(
    private readonly regDossierService: RegDossierService,
    private readonly classificationService: ClassificationService,
    private readonly completenessGateService: CompletenessGateService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRegDossiersQueryDto) {
    return this.regDossierService.list(actor, query)
  }

  /**
   * RegCloud Stage 1 — the classification wizard's live "here's what
   * you'll need" preview, read *before* a dossier is created. Must be
   * declared before `@Get(':id')` below — NestJS/Express match routes in
   * registration order, and `:id` would otherwise swallow the literal
   * `classify` segment.
   */
  @Get('classify')
  classify(@Query() query: ClassifyQueryDto) {
    return this.classificationService.classify(
      query.authorityId,
      query.productClass,
      query.route ?? '*',
    )
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.regDossierService.get(actor, id)
  }

  /** RegCloud Stage 3 — a standalone completeness re-check, for the FE to call after an attach/detach without a full dossier reload. */
  @Get(':id/completeness')
  completeness(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.completenessGateService.evaluate(actor, id)
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegDossierDto,
    @Req() req: Request,
  ) {
    return this.regDossierService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/slots')
  addSlot(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateDossierSlotDto,
    @Req() req: Request,
  ) {
    return this.regDossierService.addSlot(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/slots/:slotId/attach')
  attachDocument(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('slotId') slotId: string,
    @Body() dto: AttachDossierDocumentDto,
    @Req() req: Request,
  ) {
    return this.regDossierService.attachDocument(actor, id, slotId, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_dossier')
  @Post(':id/slots/:slotId/detach')
  detachDocument(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('slotId') slotId: string,
    @Req() req: Request,
  ) {
    return this.regDossierService.detachDocument(actor, id, slotId, { ip: req.ip })
  }
}
