import { Body, Controller, Get, Patch, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { UpdateSecurityPolicyDto } from './dto/update-security-policy.dto'
import { SecurityPolicyService } from './security-policy.service'

@ApiTags('company')
@Controller('company/security-policy')
export class SecurityPolicyController {
  constructor(private readonly securityPolicyService: SecurityPolicyService) {}

  /** Any authenticated company member can read — see SecurityPolicyService.get's doc comment for why. */
  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.securityPolicyService.get(user)
  }

  @RequirePermissions('security_policy.manage')
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSecurityPolicyDto,
    @Req() req: Request,
  ) {
    return this.securityPolicyService.update(user, dto, { ip: req.ip })
  }
}
