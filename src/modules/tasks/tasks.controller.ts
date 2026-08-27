import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ListTasksQueryDto } from './dto/list-tasks-query.dto'
import { TasksService } from './tasks.service'

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTasksQueryDto) {
    return this.tasksService.list(user, query)
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.summary(user)
  }

  @Post(':id/claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.tasksService.claim(user, id, { ip: req.ip })
  }

  @Post(':id/release')
  release(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.tasksService.release(user, id, { ip: req.ip })
  }
}
