import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DataSubjectRequestService } from './data-subject-request.service'
import { CreateDataSubjectRequestDto } from './dto/create-data-subject-request.dto'
import { ListDataSubjectRequestsQueryDto } from './dto/list-data-subject-requests-query.dto'

@ApiTags('data-privacy')
@Controller('data-subject-requests')
@RequirePermissions('data_privacy.manage')
export class DataSubjectRequestController {
  constructor(private readonly dataSubjectRequestService: DataSubjectRequestService) {}

  @Post()
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDataSubjectRequestDto,
    @Req() req: Request,
  ) {
    return this.dataSubjectRequestService.request(user, dto, { ip: req.ip })
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDataSubjectRequestsQueryDto) {
    return this.dataSubjectRequestService.list(user, query)
  }
}
