import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { UpsertRetentionPolicyDto } from './dto/upsert-retention-policy.dto'
import { RetentionPolicyService } from './retention-policy.service'

@ApiTags('quality-retention-policies')
@Controller('quality/retention-policies')
export class RetentionPolicyController {
  constructor(private readonly retentionPolicyService: RetentionPolicyService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.retentionPolicyService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get('defaults/:recordType')
  getDefault(@Param('recordType') recordType: string) {
    return { recordType, retentionYears: this.retentionPolicyService.getDefault(recordType) }
  }

  @RequirePermissions('quality.manage_documents')
  @Post()
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertRetentionPolicyDto,
    @Req() req: Request,
  ) {
    return this.retentionPolicyService.upsert(user, dto, { ip: req.ip })
  }
}
