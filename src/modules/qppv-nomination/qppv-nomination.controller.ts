import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SetQppvNominationDto } from './dto/set-qppv-nomination.dto'
import { UploadRegulatorConfirmationDto } from './dto/upload-regulator-confirmation.dto'
import { QppvNominationService } from './qppv-nomination.service'

@ApiTags('qppv')
@Controller('qppv')
export class QppvNominationController {
  constructor(private readonly qppvNominationService: QppvNominationService) {}

  @RequirePermissions('qppv.manage_nomination')
  @Post('nominations')
  setNomination(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetQppvNominationDto,
    @Req() req: Request,
  ) {
    return this.qppvNominationService.setNomination(user, dto, { ip: req.ip })
  }

  @RequirePermissions('qppv.manage_nomination')
  @Post('nominations/:id/regulator-confirmation')
  uploadRegulatorConfirmation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadRegulatorConfirmationDto,
    @Req() req: Request,
  ) {
    return this.qppvNominationService.uploadRegulatorConfirmation(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('governance.view')
  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.qppvNominationService.getStatus(user)
  }
}
