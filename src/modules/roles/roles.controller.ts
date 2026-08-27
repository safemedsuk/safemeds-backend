import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { RolesService } from './roles.service'

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Open to any authenticated user — the invite-role picker (and anyone curious what a role can do) needs it; it's catalog metadata, not sensitive. */
  @Get()
  list() {
    return this.rolesService.listCatalog()
  }
}
