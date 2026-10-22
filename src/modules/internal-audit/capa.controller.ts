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
import { ROOT_CAUSE_CATEGORIES } from '../quality/root-cause-categories.const'
import { CapaService } from './capa.service'
import { ApproveCapaDto } from './dto/approve-capa.dto'
import { AssignCapaActionDto } from './dto/assign-capa-action.dto'
import { CreateCapaDto } from './dto/create-capa.dto'
import { ListCapasQueryDto } from './dto/list-capas-query.dto'
import { ReassignCapaRegulatoryApproverDto } from './dto/reassign-capa-regulatory-approver.dto'
import { RecordCapaEffectivenessDto } from './dto/record-capa-effectiveness.dto'
import { UpdateCapaDto } from './dto/update-capa.dto'

/**
 * Pass A2 — read endpoints (`list`, `get`) and the regulatory-approver
 * reassignment carry no permission decorator on purpose: a non-manager
 * assignee or regulatory approver must be able to reach their own CAPA, and
 * `CapaService` enforces who may see what (see its class doc comment).
 * Action endpoints keep their permission gate as before.
 */
@ApiTags('capas')
@Controller('capas')
export class CapaController {
  constructor(private readonly capaService: CapaService) {}

  @Get('root-cause-categories')
  rootCauseCategories() {
    return ROOT_CAUSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))
  }

  @Get('assignable-owners')
  assignableOwners(@CurrentUser() user: AuthenticatedUser) {
    return this.capaService.listAssignableOwners(user)
  }

  @Get('assignable-regulatory-approvers')
  assignableRegulatoryApprovers(@CurrentUser() user: AuthenticatedUser) {
    return this.capaService.listAssignableRegulatoryApprovers(user)
  }

  @RequirePermissions('quality.manage_capa')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCapaDto, @Req() req: Request) {
    return this.capaService.create(user, dto, { ip: req.ip })
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListCapasQueryDto) {
    return this.capaService.list(user, query)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.capaService.get(user, id)
  }

  @RequirePermissions('quality.manage_capa')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCapaDto,
    @Req() req: Request,
  ) {
    return this.capaService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/effectiveness-check')
  recordEffectivenessCheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordCapaEffectivenessDto,
    @Req() req: Request,
  ) {
    return this.capaService.recordEffectivenessCheck(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/close')
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.capaService.close(user, id, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/action')
  assignAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignCapaActionDto,
    @Req() req: Request,
  ) {
    return this.capaService.assignAction(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.close_capa')
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveCapaDto,
    @Req() req: Request,
  ) {
    return this.capaService.approve(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_registrations')
  @Post(':id/regulatory-approve')
  regulatoryApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.capaService.regulatoryApprove(user, id, { ip: req.ip })
  }

  @Post(':id/regulatory-approver')
  reassignRegulatoryApprover(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReassignCapaRegulatoryApproverDto,
    @Req() req: Request,
  ) {
    return this.capaService.reassignRegulatoryApprover(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_capa')
  @Post(':id/implement')
  implement(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.capaService.implement(user, id, { ip: req.ip })
  }

  /** Closing evidence for a CAPA. Server-proxied, like every other document upload here. */
  @RequirePermissions('quality.manage_capa')
  @Post(':id/evidence')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  uploadEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.capaService.uploadEvidence(
      user,
      id,
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype },
      { ip: req.ip },
    )
  }
}
