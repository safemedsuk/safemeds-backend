import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateProductClassDto } from './dto/create-product-class.dto'
import { UpdateProductClassDto } from './dto/update-product-class.dto'
import { ProductClassService } from './product-class.service'

@ApiTags('product-classes')
@Controller('product-classes')
export class ProductClassController {
  constructor(private readonly productClassService: ProductClassService) {}

  /** Open to any authenticated user — catalog metadata powering every dossier-creation picker, same treatment as `GET /regulatory-authorities`/`GET /training-types`. */
  @Get()
  list(
    @Query('authorityId') authorityId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.productClassService.list(authorityId, includeInactive === 'true')
  }

  @RequirePermissions('platform.config.manage')
  @Post()
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductClassDto,
    @Req() req: Request,
  ) {
    return this.productClassService.create(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('platform.config.manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductClassDto,
    @Req() req: Request,
  ) {
    return this.productClassService.update(actor, id, dto, { ip: req.ip })
  }
}
