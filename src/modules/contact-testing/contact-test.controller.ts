import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PaginationQueryDto } from '../../common/pagination'
import { ContactTestService } from './contact-test.service'
import { LogContactTestAttemptDto } from './dto/log-contact-test-attempt.dto'
import { StartContactTestDto } from './dto/start-contact-test.dto'

@ApiTags('contact-testing')
@Controller('contact-tests')
@RequirePermissions('contact_testing.manage')
export class ContactTestController {
  constructor(private readonly contactTestService: ContactTestService) {}

  @Post()
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartContactTestDto,
    @Req() req: Request,
  ) {
    return this.contactTestService.start(user, dto, { ip: req.ip })
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.contactTestService.list(user, query)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.contactTestService.get(user, id)
  }

  @Post(':id/log-attempt')
  logAttempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: LogContactTestAttemptDto,
    @Req() req: Request,
  ) {
    return this.contactTestService.logAttempt(user, id, dto, { ip: req.ip })
  }
}
