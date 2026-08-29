import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InstantiateWorkflowDto } from './dto/instantiate-workflow.dto'
import { PostTransitionDto } from './dto/post-transition.dto'
import { WorkflowService } from './workflow.service'

@ApiTags('workflow')
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Get('definitions/:id')
  getDefinition(@Param('id') id: string) {
    return this.workflowService.getDefinition(id)
  }

  @Post('instances')
  instantiate(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: InstantiateWorkflowDto,
    @Req() req: Request,
  ) {
    return this.workflowService.instantiate(
      actor,
      dto.recordType,
      dto.recordId,
      dto.countryId ?? null,
      { ip: req.ip },
    )
  }

  @Get('instances/:id')
  getInstance(@Param('id') id: string) {
    return this.workflowService.getInstance(id)
  }

  @Get('instances/:id/available-transitions')
  availableTransitions(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.workflowService.availableTransitions(id, actor)
  }

  @Post('instances/:id/transition')
  transition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PostTransitionDto,
    @Req() req: Request,
  ) {
    return this.workflowService.transition(
      actor,
      id,
      dto.toStateKey,
      {
        signatureToken: dto.signatureToken,
        intentStatement: dto.intentStatement,
        note: dto.note,
        payload: dto.payload,
      },
      { ip: req.ip },
    )
  }
}
