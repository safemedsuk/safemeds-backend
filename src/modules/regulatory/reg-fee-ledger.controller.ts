import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { CreateRegFeeInvoiceDto } from './dto/create-reg-fee-invoice.dto'
import { ListRegFeeInvoicesQueryDto } from './dto/list-reg-fee-invoices-query.dto'
import { RecordRegFeePaymentDto } from './dto/record-reg-fee-payment.dto'
import { RegFeeLedgerService } from './reg-fee-ledger.service'

@ApiTags('reg-fee-invoices')
@Controller('reg-fee-invoices')
@RequirePermissions('regulatory.view_all')
export class RegFeeLedgerController {
  constructor(private readonly regFeeLedgerService: RegFeeLedgerService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListRegFeeInvoicesQueryDto) {
    return this.regFeeLedgerService.list(actor, query)
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.regFeeLedgerService.get(actor, id)
  }

  @RequirePermissions('regulatory.manage_fees')
  @Post()
  createInvoice(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateRegFeeInvoiceDto,
    @Req() req: Request,
  ) {
    return this.regFeeLedgerService.createInvoice(actor, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_fees')
  @Post(':id/payments')
  recordPayment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordRegFeePaymentDto,
    @Req() req: Request,
  ) {
    return this.regFeeLedgerService.recordPayment(actor, id, dto, { ip: req.ip })
  }

  @RequirePermissions('regulatory.manage_fees')
  @Post(':id/waive')
  waive(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Req() req: Request) {
    return this.regFeeLedgerService.waive(actor, id, { ip: req.ip })
  }
}
