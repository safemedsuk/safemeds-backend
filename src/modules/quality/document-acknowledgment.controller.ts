import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DocumentAcknowledgmentService } from './document-acknowledgment.service'
import { AssignReadersDto } from './dto/assign-readers.dto'

@ApiTags('quality-document-acknowledgments')
@Controller('quality/sops/:sopId/acknowledgments')
export class DocumentAcknowledgmentController {
  constructor(private readonly acknowledgmentService: DocumentAcknowledgmentService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  listForDocument(@CurrentUser() user: AuthenticatedUser, @Param('sopId') sopId: string) {
    return this.acknowledgmentService.listForDocument(user, sopId)
  }

  @RequirePermissions('quality.manage_documents')
  @Post('assign')
  assignReaders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sopId') sopId: string,
    @Body() dto: AssignReadersDto,
    @Req() req: Request,
  ) {
    return this.acknowledgmentService.assignReaders(user, sopId, dto, { ip: req.ip })
  }

  // Any authenticated tenant user can acknowledge their own assignment —
  // deliberately no `quality.*` gate here (acknowledging is a personal
  // action available to whoever was assigned, not a quality-role action).
  @Post('acknowledge')
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sopId') sopId: string,
    @Req() req: Request,
  ) {
    return this.acknowledgmentService.acknowledge(user, sopId, { ip: req.ip })
  }
}

@ApiTags('quality-document-acknowledgments')
@Controller('quality/document-acknowledgments')
export class DocumentAcknowledgmentOverdueController {
  constructor(private readonly acknowledgmentService: DocumentAcknowledgmentService) {}

  @RequirePermissions('quality.view_all')
  @Get('overdue')
  listOverdue(@CurrentUser() user: AuthenticatedUser) {
    return this.acknowledgmentService.listOverdue(user)
  }
}
