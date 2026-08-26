import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListRegDeadlinesQueryDto } from './dto/list-reg-deadlines-query.dto'
import { RegDeadlineService } from './reg-deadline.service'

@ApiTags('reg-deadlines')
@Controller('reg-deadlines')
export class RegDeadlineController {
  constructor(private readonly regDeadlineService: RegDeadlineService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRegDeadlinesQueryDto) {
    return this.regDeadlineService.list(actor, query)
  }
}
