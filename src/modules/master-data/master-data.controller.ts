import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateBatchDto } from './dto/create-batch.dto'
import { CreateProductDto } from './dto/create-product.dto'
import { CreateProductRegistrationDto } from './dto/create-product-registration.dto'
import { ListBatchesQueryDto } from './dto/list-batches-query.dto'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto'
import { UpdateBatchDto } from './dto/update-batch.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { UpdateProductRegistrationDto } from './dto/update-product-registration.dto'
import { MasterDataService } from './master-data.service'

@ApiTags('master-data')
@Controller()
@RequirePermissions('master_data.view')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('products')
  listProducts(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListProductsQueryDto) {
    return this.masterDataService.listProducts(actor, query)
  }

  @RequirePermissions('master_data.manage')
  @Post('products')
  createProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.createProduct(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Patch('products/:id')
  updateProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.updateProduct(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Post('products/:id/deactivate')
  deactivateProduct(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.masterDataService.deactivateProduct(actor, id, { ip: req.ip })
  }

  @Get('batches')
  listBatches(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListBatchesQueryDto) {
    return this.masterDataService.listBatches(actor, query)
  }

  @RequirePermissions('master_data.manage')
  @Post('batches')
  createBatch(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateBatchDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.createBatch(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Patch('batches/:id')
  updateBatch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBatchDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.updateBatch(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Post('batches/:id/deactivate')
  deactivateBatch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.masterDataService.deactivateBatch(actor, id, { ip: req.ip })
  }

  @Get('registrations')
  listRegistrations(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListRegistrationsQueryDto,
  ) {
    return this.masterDataService.listRegistrations(actor, query)
  }

  @RequirePermissions('master_data.manage')
  @Post('registrations')
  createRegistration(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductRegistrationDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.createRegistration(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Patch('registrations/:id')
  updateRegistration(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductRegistrationDto,
    @Req() req: Request,
  ) {
    return this.masterDataService.updateRegistration(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('master_data.manage')
  @Post('registrations/:id/deactivate')
  deactivateRegistration(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.masterDataService.deactivateRegistration(actor, id, { ip: req.ip })
  }
}
