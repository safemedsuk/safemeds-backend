import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { GenerateLineListingDto } from './dto/generate-line-listing.dto'
import { LineListingService } from './line-listing.service'

@ApiTags('line-listings')
@Controller('reporting/line-listings')
export class LineListingController {
  constructor(private readonly lineListingService: LineListingService) {}

  @RequirePermissions('reports.manage')
  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateLineListingDto,
    @Req() req: Request,
  ) {
    return this.lineListingService.generate(user, dto, { ip: req.ip })
  }
}
