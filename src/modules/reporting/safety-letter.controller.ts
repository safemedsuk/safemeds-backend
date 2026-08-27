import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GenerateSafetyLetterDto } from './dto/generate-safety-letter.dto'
import { SafetyLetterService } from './safety-letter.service'

@ApiTags('safety-letters')
@Controller('safety-letters')
export class SafetyLetterController {
  constructor(private readonly safetyLetterService: SafetyLetterService) {}

  @RequirePermissions('safety_alerts.manage')
  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSafetyLetterDto,
    @Req() req: Request,
  ) {
    return this.safetyLetterService.generate(user, dto, { ip: req.ip })
  }

  @RequirePermissions('safety_alerts.manage')
  @Post(':id/dispatch')
  dispatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.safetyLetterService.dispatch(user, id, { ip: req.ip })
  }

  @RequirePermissions('safety_alerts.view')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.safetyLetterService.get(user, id)
  }
}
