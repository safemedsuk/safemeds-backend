import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AuditService } from './audit.service'
import { QueryAuditDto } from './dto/query-audit.dto'

@ApiTags('audit')
@Controller()
@RequirePermissions('audit.read')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit')
  query(@CurrentUser() actor: AuthenticatedUser, @Query() dto: QueryAuditDto) {
    return this.auditService.query(actor, dto)
  }

  @Get('records/:type/:id/history')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() pagination: QueryAuditDto,
  ) {
    return this.auditService.history(actor, type, id, pagination)
  }
}
