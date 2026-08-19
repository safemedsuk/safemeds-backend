import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto'
import { RejectRegistrationDto } from './dto/reject-registration.dto'
import { PlatformService } from './platform.service'
import { PlatformOnly } from './platform-only.decorator'

@ApiTags('platform')
@Controller('platform/registrations')
@PlatformOnly('super_admin', 'operations')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  list(@Query() query: ListRegistrationsQueryDto) {
    return this.platformService.listRegistrations(query)
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.platformService.getRegistration(id)
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.platformService.approve(id, user.sub)
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.platformService.reject(id, user.sub, dto.reason)
  }
}
