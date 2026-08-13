import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ConsentService } from './consent.service'
import { CaptureConsentDto } from './dto/capture-consent.dto'
import { CheckConsentQueryDto } from './dto/check-consent-query.dto'
import { ListConsentQueryDto } from './dto/list-consent-query.dto'

@ApiTags('consent')
@Controller('consent-records')
@RequirePermissions('consent.manage')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post()
  capture(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CaptureConsentDto,
    @Req() req: Request,
  ) {
    return this.consentService.capture(user, dto, { ip: req.ip })
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.consentService.withdraw(user, id, { ip: req.ip })
  }

  @Get('check')
  check(@CurrentUser() user: AuthenticatedUser, @Query() query: CheckConsentQueryDto) {
    return this.consentService.check(user, query.recordType, query.recordId, query.consentType)
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListConsentQueryDto) {
    return this.consentService.list(user, query)
  }
}
