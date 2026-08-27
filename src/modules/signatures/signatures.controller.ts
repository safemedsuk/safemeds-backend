import { Controller, Get, Param, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SignatureService } from './signature.service'

@ApiTags('signatures')
@Controller()
export class SignaturesController {
  constructor(private readonly signatureService: SignatureService) {}

  @RequirePermissions('signatures.read')
  @Get('records/:type/:id/signatures')
  listForRecord(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.signatureService.listForRecord(actor, type, id)
  }

  @RequirePermissions('signatures.verify')
  @Post('signatures/:id/verify')
  verify(@Param('id') id: string) {
    return this.signatureService.verify(id)
  }
}
