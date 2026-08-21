import { Controller, Get, Param, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GlobalMoleculeIntelligenceService } from './global-molecule-intelligence.service'

@ApiTags('molecule-intelligence')
@Controller('pv/molecule-intelligence')
export class GlobalMoleculeIntelligenceController {
  constructor(private readonly moleculeIntelligenceService: GlobalMoleculeIntelligenceService) {}

  @RequirePermissions('pv.view_molecule_intelligence')
  @Get('molecules')
  listOwnMolecules(@CurrentUser() user: AuthenticatedUser) {
    return this.moleculeIntelligenceService.listOwnMolecules(user)
  }

  @RequirePermissions('pv.view_molecule_intelligence')
  @Get(':moleculeName')
  getMoleculeView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('moleculeName') moleculeName: string,
    @Req() req: Request,
  ) {
    return this.moleculeIntelligenceService.getMoleculeView(user, moleculeName, { ip: req.ip })
  }
}
