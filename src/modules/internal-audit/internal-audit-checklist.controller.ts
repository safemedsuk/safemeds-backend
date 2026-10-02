import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { UpdateChecklistResponseDto } from './dto/update-checklist-response.dto'
import { InternalAuditChecklistService } from './internal-audit-checklist.service'

@ApiTags('internal-audits')
@Controller('internal-audits/:auditId/checklist')
export class InternalAuditChecklistController {
  constructor(private readonly checklistService: InternalAuditChecklistService) {}

  @RequirePermissions('quality.manage_capa')
  @Post('start')
  startConduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('auditId') auditId: string,
    @Req() req: Request,
  ) {
    return this.checklistService.startConduct(actor, auditId, { ip: req.ip })
  }

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Param('auditId') auditId: string) {
    return this.checklistService.list(actor, auditId)
  }

  @RequirePermissions('quality.manage_capa')
  @Patch(':responseId')
  respond(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('responseId') responseId: string,
    @Body() dto: UpdateChecklistResponseDto,
    @Req() req: Request,
  ) {
    return this.checklistService.respond(actor, responseId, dto, { ip: req.ip })
  }
}
