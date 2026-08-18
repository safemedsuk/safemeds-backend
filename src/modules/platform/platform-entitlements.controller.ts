import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GrantEntitlementDto } from '../entitlements/dto/grant-entitlement.dto'
import { ListCompaniesQueryDto } from '../entitlements/dto/list-companies-query.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { PlatformOnly } from './platform-only.decorator'

/**
 * The monetisation console (Stage 0.5) — deliberately `super_admin`-only,
 * not `operations` too, unlike registration review: this gates paid
 * provisioning, which the Final build spec frames as a founder-level
 * decision ("Kien rules on..."), not a day-to-day ops queue task.
 */
@ApiTags('platform')
@Controller('platform')
@PlatformOnly('super_admin')
export class PlatformEntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get('companies')
  listCompanies(@Query() query: ListCompaniesQueryDto) {
    return this.entitlementsService.listCompanies(query)
  }

  @Get('companies/:companyId/entitlements')
  listForCompany(@CurrentUser() user: AuthenticatedUser, @Param('companyId') companyId: string) {
    return this.entitlementsService.listForCompany(user.sub, companyId)
  }

  @Post('companies/:companyId/entitlements')
  grant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
    @Body() dto: GrantEntitlementDto,
    @Req() req: Request,
  ) {
    return this.entitlementsService.grant(user.sub, companyId, dto, { ip: req.ip })
  }
}
