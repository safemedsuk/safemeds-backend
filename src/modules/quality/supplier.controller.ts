import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateSupplierDto } from './dto/create-supplier.dto'
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto'
import { UpdateSupplierDto } from './dto/update-supplier.dto'
import { SupplierService } from './supplier.service'

@ApiTags('quality-suppliers')
@Controller('quality/suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @RequirePermissions('quality.view_all')
  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSuppliersQueryDto) {
    return this.supplierService.list(user, query)
  }

  @RequirePermissions('quality.view_all')
  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierService.get(user, id)
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierDto,
    @Req() req: Request,
  ) {
    return this.supplierService.create(user, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_suppliers')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: Request,
  ) {
    return this.supplierService.update(user, id, dto, { ip: req.ip })
  }

  @RequirePermissions('quality.manage_suppliers')
  @Post(':id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.supplierService.deactivate(user, id, { ip: req.ip })
  }
}
