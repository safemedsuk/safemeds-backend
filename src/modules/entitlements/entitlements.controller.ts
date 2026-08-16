import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { EntitlementsService } from './entitlements.service'

/** Tenant self-service view — any authenticated company member can see which modules/features their own company has, same "any member can read" precedent as `SecurityPolicyController.get`. */
@ApiTags('entitlements')
@Controller('entitlements')
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.entitlementsService.listMine(user)
  }
}
