import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DeadlineService } from './deadline.service'
import { ListDeadlinesQueryDto } from './dto/list-deadlines-query.dto'

@ApiTags('deadlines')
@Controller('deadlines')
export class DeadlineController {
  constructor(private readonly deadlineService: DeadlineService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListDeadlinesQueryDto) {
    return this.deadlineService.list(actor, query)
  }
}
