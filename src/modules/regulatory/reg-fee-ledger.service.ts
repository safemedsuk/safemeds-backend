import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { RegFeeInvoice, RegFeePayment } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { TasksService } from '../tasks/tasks.service'
import { CreateRegFeeInvoiceDto } from './dto/create-reg-fee-invoice.dto'
import { ListRegFeeInvoicesQueryDto } from './dto/list-reg-fee-invoices-query.dto'
import { RecordRegFeePaymentDto } from './dto/record-reg-fee-payment.dto'
import { RegConfigService } from './reg-config.service'

export interface RequestMeta {
  ip?: string
}

export type RegFeeInvoiceWithPayments = RegFeeInvoice & { payments: RegFeePayment[] }

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'The fee ledger is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * RegCloud (Phase 12) Stage 0.5 — Fees Ledger. Deliberately **not** a
 * payment-processing integration (no Stripe/M-Pesa in scope, per the Build
 * Priority doc's own silence on this) — a ledger and reminder mechanism
 * only, matching this project's own established "log it, don't automate
 * the money movement" discipline (Contact Testing, Literature Monitoring).
 *
 * `status` only ever reaches `paid` once the sum of an invoice's own
 * `RegFeePayment` rows meets or exceeds its `amount` — a partial payment
 * stays `pending`/`overdue`, genuinely logged, never silently treated as
 * settled.
 */
@Injectable()
export class RegFeeLedgerService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regConfigService: RegConfigService,
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListRegFeeInvoicesQueryDto,
  ): Promise<PaginatedResult<RegFeeInvoiceWithPayments>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where = {
        companyId,
        ...(query.productRegistrationId
          ? { productRegistrationId: query.productRegistrationId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.regFeeInvoice.findMany({
          where,
          include: { payments: true },
          orderBy: { dueAt: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.regFeeInvoice.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async get(actor: AuthenticatedUser, id: string): Promise<RegFeeInvoiceWithPayments> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const invoice = await tx.regFeeInvoice.findUnique({
        where: { id },
        include: { payments: true },
      })
      if (!invoice) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' })
      return invoice
    })
  }

  async createInvoice(
    actor: AuthenticatedUser,
    dto: CreateRegFeeInvoiceDto,
    meta: RequestMeta,
  ): Promise<RegFeeInvoice> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      if (dto.productRegistrationId) {
        const registration = await tx.productRegistration.findUnique({
          where: { id: dto.productRegistrationId },
        })
        if (!registration)
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Product registration not found',
          })
      }
      if (dto.regDossierId) {
        const dossier = await tx.regDossier.findUnique({ where: { id: dto.regDossierId } })
        if (!dossier)
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Dossier not found' })
      }

      const created = await tx.regFeeInvoice.create({
        data: {
          id: newId(),
          companyId,
          productRegistrationId: dto.productRegistrationId,
          regDossierId: dto.regDossierId,
          feeType: dto.feeType,
          amount: dto.amount,
          currency: dto.currency ?? 'KES',
          dueAt: new Date(dto.dueAt),
          description: dto.description,
          status: 'pending',
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_fee_invoice_created',
        recordType: 'reg_fee_invoice',
        recordId: created.id,
        newValue: {
          feeType: dto.feeType,
          amount: dto.amount,
          currency: created.currency,
          dueAt: dto.dueAt,
        },
        ip: meta.ip,
      })

      return created
    })
  }

  async recordPayment(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: RecordRegFeePaymentDto,
    meta: RequestMeta,
  ): Promise<RegFeeInvoiceWithPayments> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const invoice = await tx.regFeeInvoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      })
      if (!invoice) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' })

      await tx.regFeePayment.create({
        data: {
          id: newId(),
          invoiceId,
          companyId,
          amount: dto.amount,
          paidAt: new Date(dto.paidAt),
          method: dto.method,
          reference: dto.reference,
          recordedBy: actor.sub,
        },
      })

      const totalPaid = [
        ...invoice.payments.map((p) => Number(p.amount)),
        Number(dto.amount),
      ].reduce((sum, n) => sum + n, 0)
      const isFullyPaid = totalPaid >= Number(invoice.amount)

      const updated = await tx.regFeeInvoice.update({
        where: { id: invoiceId },
        data: isFullyPaid ? { status: 'paid' } : {},
        include: { payments: true },
      })

      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_fee_payment_recorded',
        recordType: 'reg_fee_invoice',
        recordId: invoiceId,
        newValue: { amount: dto.amount, paidAt: dto.paidAt, totalPaid, isFullyPaid },
        ip: meta.ip,
      })

      return updated
    })
  }

  async waive(
    actor: AuthenticatedUser,
    invoiceId: string,
    meta: RequestMeta,
  ): Promise<RegFeeInvoice> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const invoice = await tx.regFeeInvoice.findUnique({ where: { id: invoiceId } })
      if (!invoice) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invoice not found' })

      const updated = await tx.regFeeInvoice.update({
        where: { id: invoiceId },
        data: { status: 'waived' },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'reg_fee_invoice_waived',
        recordType: 'reg_fee_invoice',
        recordId: invoiceId,
        oldValue: { status: invoice.status },
        newValue: { status: 'waived' },
        ip: meta.ip,
      })
      return updated
    })
  }

  /**
   * The one live, automatic trigger this pass wires (mirroring
   * `RegDeadlineService.computeOrRecompute()`'s own "the one concretely
   * available consumer" framing) — called from `MasterDataService
   * .createRegistration()`. Never throws and never blocks the caller: an
   * unconfigured market (no active `application`-type
   * `RegulatoryFeeSchedule` yet) simply means no invoice is created.
   */
  async createApplicationFeeInvoiceOnRegistration(
    companyId: string,
    productRegistrationId: string,
    countryId: string,
    authorityId: string,
    productClass: string,
    actorUserId: string | null,
  ): Promise<void> {
    const schedules = await this.regConfigService.resolveFeeSchedules(
      countryId,
      authorityId,
      productClass,
      '*',
    )
    const applicationFee = schedules.find((s) => s.feeType === 'application')
    if (!applicationFee) return

    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.regFeeInvoice.create({
        data: {
          id: newId(),
          companyId,
          productRegistrationId,
          regulatoryFeeScheduleId: applicationFee.id,
          feeType: 'application',
          amount: applicationFee.amount,
          currency: applicationFee.currency,
          dueAt,
          description:
            'Application fee, auto-generated from the active fee schedule at registration creation.',
          status: 'pending',
          createdBy: actorUserId,
        },
      })

      await this.auditService.log(tx, {
        actorUserId,
        companyId,
        action: 'reg_fee_invoice_auto_created',
        recordType: 'reg_fee_invoice',
        recordId: created.id,
        newValue: {
          productRegistrationId,
          feeType: 'application',
          amount: applicationFee.amount.toString(),
        },
      })
    })
  }

  /** The daily sweep's actual work — flip a `pending` invoice past its due date to `overdue`, exactly once. */
  async scanAndFlagOverdue(): Promise<{ flagged: number }> {
    const now = new Date()

    const overdue = await this.rls.runWithSystemAccess((tx) =>
      tx.regFeeInvoice.findMany({
        where: { status: 'pending', dueAt: { lt: now }, notifiedOverdueAt: null },
      }),
    )

    for (const invoice of overdue) {
      await this.rls.runAsCompany(invoice.companyId, async (tx) => {
        await tx.regFeeInvoice.update({
          where: { id: invoice.id },
          data: { status: 'overdue', notifiedOverdueAt: now },
        })
        await this.auditService.log(tx, {
          companyId: invoice.companyId,
          actorType: 'system',
          action: 'reg_fee_invoice_overdue',
          recordType: 'reg_fee_invoice',
          recordId: invoice.id,
          newValue: { dueAt: invoice.dueAt.toISOString(), amount: invoice.amount.toString() },
        })
      })

      const title = `Regulatory fee overdue: ${invoice.feeType} (${invoice.currency} ${invoice.amount.toString()}), due ${invoice.dueAt.toISOString().slice(0, 10)}`
      await this.tasksService.escalateForRecord(
        invoice.companyId,
        'reg_fee_invoice',
        invoice.id,
        'overdue',
        title,
        {},
      )

      const recipients = await this.rls.runAsCompany(invoice.companyId, (tx) =>
        tx.user.findMany({
          where: {
            companyId: invoice.companyId,
            roleKeys: { has: 'REGULATORY_AFFAIRS_OFFICER' },
            status: 'active',
          },
          select: { id: true, email: true },
        }),
      )
      for (const recipient of recipients) {
        await this.notificationsService.create({
          companyId: invoice.companyId,
          userId: recipient.id,
          category: 'deadline_breached',
          title,
          body: `${title}. Invoice ${invoice.id}.`,
          type: 'fee_overdue',
          params: {
            feeType: invoice.feeType,
            currency: invoice.currency,
            amount: invoice.amount.toString(),
            dueDate: invoice.dueAt.toISOString().slice(0, 10),
            invoiceId: invoice.id,
          },
          recordType: 'reg_fee_invoice',
          recordId: invoice.id,
        })
      }
    }

    return { flagged: overdue.length }
  }
}
