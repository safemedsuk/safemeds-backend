import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PlatformOnly } from '../platform/platform-only.decorator'
import { DistributorService } from './distributor.service'
import { LinkDistributorTenantDto } from './dto/link-distributor-tenant.dto'
import { ListPlatformDistributorsQueryDto } from './dto/list-platform-distributors-query.dto'

/**
 * VigiCloud Stage 15.1 — `super_admin`-only, matching Stage 0.5's
 * entitlement-console precedent: establishing that a `Distributor` row
 * is really a specific SafeMeds tenant is a real-world-relationship
 * verification only SafeMeds staff can make, never a tenant's own
 * self-service action — see `CreateDistributorDto`'s own doc comment.
 * The company picker itself reuses the already-built `GET
 * /platform/companies` from `PlatformEntitlementsController` rather than
 * a second, parallel one.
 */
@ApiTags('platform')
@Controller('platform/distributors')
@PlatformOnly('super_admin')
export class PlatformDistributorsController {
  constructor(private readonly distributorService: DistributorService) {}

  @Get()
  list(@Query() query: ListPlatformDistributorsQueryDto) {
    return this.distributorService.listAllForPlatform(query)
  }

  @Get(':id/suggestions')
  suggestions(@Param('id') id: string) {
    return this.distributorService.suggestTenantMatches(id)
  }

  @Patch(':id/link-tenant')
  linkTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LinkDistributorTenantDto,
    @Req() req: Request,
  ) {
    return this.distributorService.linkTenant(user.sub, id, dto.targetCompanyId ?? null, {
      ip: req.ip,
    })
  }
}
