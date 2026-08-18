import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Batch, Prisma, Product, ProductRegistration } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { paginate, PaginatedResult } from '../../common/pagination'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RegDeadlineService } from '../regulatory/reg-deadline.service'
import { RegFeeLedgerService } from '../regulatory/reg-fee-ledger.service'
import { RegPostMarketObligationService } from '../regulatory/reg-post-market-obligation.service'
import { LocationScopeService } from '../tenancy/location-scope.service'
import { CreateBatchDto } from './dto/create-batch.dto'
import { CreateProductDto } from './dto/create-product.dto'
import { CreateProductRegistrationDto } from './dto/create-product-registration.dto'
import { ListBatchesQueryDto } from './dto/list-batches-query.dto'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { ListRegistrationsQueryDto } from './dto/list-registrations-query.dto'
import { UpdateBatchDto } from './dto/update-batch.dto'
import { UpdateProductDto } from './dto/update-product.dto'
import { UpdateProductRegistrationDto } from './dto/update-product-registration.dto'

export interface RequestMeta {
  ip?: string
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Master data is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

/**
 * Phase 7 — CRUD is create/read/update only; there is no delete endpoint
 * anywhere in this service, by design ("deactivate, never delete" per the
 * build spec) — `Product`/`Batch` get an `isActive` flag, and
 * `ProductRegistration` reuses its own lifecycle `status` (withdrawn is
 * its "deactivated"). Every table here has real Postgres RLS
 * (phase7_1 migration), so every method runs through `RlsService.runAsCompany`
 * — a single call per method, since `runAsCompany`'s callback already runs
 * inside one transaction (its `tx` has no further `$transaction` of its own
 * to nest into, unlike the top-level `PrismaService`).
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regDeadlineService: RegDeadlineService,
    private readonly locationScopeService: LocationScopeService,
    private readonly regFeeLedgerService: RegFeeLedgerService,
    private readonly regPostMarketObligationService: RegPostMarketObligationService,
  ) {}

  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(
    actor: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<PaginatedResult<Product>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ProductWhereInput = {
        companyId,
        ...(query.q
          ? {
              OR: [
                { brandName: { contains: query.q, mode: 'insensitive' } },
                { genericName: { contains: query.q, mode: 'insensitive' } },
                { innName: { contains: query.q, mode: 'insensitive' } },
                { atcCode: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      }
      const [rows, total] = await Promise.all([
        tx.product.findMany({
          where,
          orderBy: { brandName: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.product.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async createProduct(
    actor: AuthenticatedUser,
    dto: CreateProductDto,
    meta: RequestMeta,
  ): Promise<Product> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.product.create({
        data: {
          id: newId(),
          companyId,
          ...dto,
          internationalBirthDate: dto.internationalBirthDate
            ? new Date(dto.internationalBirthDate)
            : undefined,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_created',
        recordType: 'product',
        recordId: created.id,
        newValue: { ...dto },
        ip: meta.ip,
      })
      return created
    })
  }

  async updateProduct(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
    meta: RequestMeta,
  ): Promise<Product> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const updated = await tx.product.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.internationalBirthDate !== undefined
            ? { internationalBirthDate: new Date(dto.internationalBirthDate) }
            : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_updated',
        recordType: 'product',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivateProduct(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<Product> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const updated = await tx.product.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_deactivated',
        recordType: 'product',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }

  // ── Batches ───────────────────────────────────────────────────────────────

  async listBatches(
    actor: AuthenticatedUser,
    query: ListBatchesQueryDto,
  ): Promise<PaginatedResult<Batch & { product: { brandName: string } }>> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.BatchWhereInput = {
        companyId,
        ...(query.productId ? { productId: query.productId } : {}),
      }
      const [rows, total] = await Promise.all([
        tx.batch.findMany({
          where,
          include: { product: { select: { brandName: true } } },
          orderBy: { expiresOn: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.batch.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async createBatch(
    actor: AuthenticatedUser,
    dto: CreateBatchDto,
    meta: RequestMeta,
  ): Promise<Batch> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const created = await tx.batch.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          batchNumber: dto.batchNumber,
          manufacturedOn: new Date(dto.manufacturedOn),
          expiresOn: new Date(dto.expiresOn),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_created',
        recordType: 'batch',
        recordId: created.id,
        newValue: { productId: dto.productId, batchNumber: dto.batchNumber },
        ip: meta.ip,
      })
      return created
    })
  }

  async updateBatch(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateBatchDto,
    meta: RequestMeta,
  ): Promise<Batch> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.batch.findUnique({ where: { id } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      const updated = await tx.batch.update({
        where: { id },
        data: {
          ...(dto.batchNumber !== undefined ? { batchNumber: dto.batchNumber } : {}),
          ...(dto.manufacturedOn !== undefined
            ? { manufacturedOn: new Date(dto.manufacturedOn) }
            : {}),
          ...(dto.expiresOn !== undefined ? { expiresOn: new Date(dto.expiresOn) } : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_updated',
        recordType: 'batch',
        recordId: id,
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })
      return updated
    })
  }

  async deactivateBatch(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<Batch> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.batch.findUnique({ where: { id } })
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found' })

      const updated = await tx.batch.update({ where: { id }, data: { isActive: false } })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'batch_deactivated',
        recordType: 'batch',
        recordId: id,
        ip: meta.ip,
      })
      return updated
    })
  }

  // ── Product registrations ────────────────────────────────────────────────

  async listRegistrations(
    actor: AuthenticatedUser,
    query: ListRegistrationsQueryDto,
  ): Promise<
    PaginatedResult<
      ProductRegistration & {
        product: { brandName: string }
        authority: { name: string; code: string }
      }
    >
  > {
    const companyId = requireCompany(actor)
    // RegCloud (Phase 12) Stage 0.6 — `ProductRegistration` has a real
    // country dimension (`authorityId → countryId`) but no `facilityId`,
    // so `EffectiveAccess.facilityIds` (this mechanism's original,
    // Facility-shaped consumer) can't scope it — `countryIds` is the new
    // field added for exactly this. A market/facility-scoped
    // `REGULATORY_AFFAIRS_OFFICER` now only sees registrations under an
    // authority in one of their granted countries; unrestricted users
    // (including every `SYSTEM_ADMINISTRATOR`) are unaffected.
    const access = await this.locationScopeService.getEffectiveAccess(
      companyId,
      actor.sub,
      actor.roleKeys,
    )
    return this.rls.runAsCompany(companyId, async (tx) => {
      const where: Prisma.ProductRegistrationWhereInput = {
        companyId,
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.q ? { registrationNumber: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.expiringWithinDays !== undefined
          ? {
              expiresOn: {
                lte: new Date(Date.now() + query.expiringWithinDays * 24 * 60 * 60 * 1000),
              },
            }
          : {}),
        ...(access.unrestricted ? {} : { authority: { countryId: { in: access.countryIds } } }),
      }
      const [rows, total] = await Promise.all([
        tx.productRegistration.findMany({
          where,
          include: {
            product: { select: { brandName: true } },
            authority: { select: { name: true, code: true } },
          },
          orderBy: { expiresOn: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.productRegistration.count({ where }),
      ])
      return paginate(rows, total, query)
    })
  }

  async createRegistration(
    actor: AuthenticatedUser,
    dto: CreateProductRegistrationDto,
    meta: RequestMeta,
  ): Promise<ProductRegistration> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: dto.productId } })
      if (!product) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' })

      const created = await tx.productRegistration.create({
        data: {
          id: newId(),
          companyId,
          productId: dto.productId,
          authorityId: dto.authorityId,
          registrationNumber: dto.registrationNumber,
          issuedOn: new Date(dto.issuedOn),
          expiresOn: new Date(dto.expiresOn),
          status: 'active',
          manufacturingSiteId: dto.manufacturingSiteId,
          localRepresentativeId: dto.localRepresentativeId,
          mahName: dto.mahName,
          mahCountry: dto.mahCountry,
          productClass: dto.productClass,
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_registration_created',
        recordType: 'product_registration',
        recordId: created.id,
        newValue: { productId: dto.productId, registrationNumber: dto.registrationNumber },
        ip: meta.ip,
      })

      await this.recomputeRenewalDeadline(actor, companyId, created, tx)
      await this.createApplicationFeeInvoiceIfConfigured(actor, companyId, created, tx)
      await this.regPostMarketObligationService.ensureObligationsForRegistration(
        companyId,
        created,
        actor.sub,
      )
      return created
    })
  }

  async updateRegistration(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductRegistrationDto,
    meta: RequestMeta,
  ): Promise<ProductRegistration> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.productRegistration.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Product registration not found',
        })

      const updated = await tx.productRegistration.update({
        where: { id },
        data: {
          ...(dto.registrationNumber !== undefined
            ? { registrationNumber: dto.registrationNumber }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.issuedOn !== undefined ? { issuedOn: new Date(dto.issuedOn) } : {}),
          ...(dto.expiresOn !== undefined ? { expiresOn: new Date(dto.expiresOn) } : {}),
          ...(dto.manufacturingSiteId !== undefined
            ? { manufacturingSiteId: dto.manufacturingSiteId }
            : {}),
          ...(dto.localRepresentativeId !== undefined
            ? { localRepresentativeId: dto.localRepresentativeId }
            : {}),
          ...(dto.mahName !== undefined ? { mahName: dto.mahName } : {}),
          ...(dto.mahCountry !== undefined ? { mahCountry: dto.mahCountry } : {}),
          ...(dto.productClass !== undefined ? { productClass: dto.productClass } : {}),
        },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_registration_updated',
        recordType: 'product_registration',
        recordId: id,
        oldValue: { status: existing.status },
        newValue: dto as Record<string, unknown>,
        ip: meta.ip,
      })

      if (dto.issuedOn !== undefined || dto.productClass !== undefined) {
        await this.recomputeRenewalDeadline(actor, companyId, updated, tx)
      }
      if (dto.productClass !== undefined) {
        // A changed product class may resolve a different set of active
        // post-market obligation rules — `ensureObligationsForRegistration()`
        // is create-only per `obligationType`, so this never disturbs an
        // already-tracked obligation's own cadence/history.
        await this.regPostMarketObligationService.ensureObligationsForRegistration(
          companyId,
          updated,
          actor.sub,
        )
      }
      return updated
    })
  }

  async deactivateRegistration(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<ProductRegistration> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await tx.productRegistration.findUnique({ where: { id } })
      if (!existing)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Product registration not found',
        })

      const updated = await tx.productRegistration.update({
        where: { id },
        data: { status: 'withdrawn' },
      })
      await this.auditService.log(tx, {
        actorUserId: actor.sub,
        companyId,
        action: 'product_registration_withdrawn',
        recordType: 'product_registration',
        recordId: id,
        oldValue: { status: existing.status },
        newValue: { status: 'withdrawn' },
        ip: meta.ip,
      })
      return updated
    })
  }

  /**
   * RegCloud (Phase 12) Stage 0.4 — the one live wiring of the deadline
   * engine this pass builds. Never throws and never blocks the caller's
   * own transaction — an unconfigured market (no active `RegDeadlineRule`
   * yet) simply means no `RegDeadline` gets computed, exactly the same
   * graceful-degradation shape every other `resolve*` consumer in this
   * codebase follows. `RegDeadlineService.computeOrRecompute()` calls
   * `this.rls.runAsCompany()` internally, which safely reuses the current
   * transaction (see that service's own doc comment) rather than opening
   * a second one.
   */
  private async recomputeRenewalDeadline(
    actor: AuthenticatedUser,
    companyId: string,
    registration: ProductRegistration,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const authority = await tx.regulatoryAuthority.findUnique({
      where: { id: registration.authorityId },
    })
    if (!authority) return

    await this.regDeadlineService.computeOrRecompute({
      companyId,
      recordType: 'reg_registration_renewal',
      recordId: registration.id,
      countryId: authority.countryId,
      authorityId: registration.authorityId,
      productClass: registration.productClass ?? '*',
      obligationType: 'renewal',
      triggerDate: registration.issuedOn,
      actorUserId: actor.sub,
    })
  }

  /**
   * RegCloud (Phase 12) Stage 0.5 — the one live wiring the Fees Ledger
   * gets this pass, deliberately parallel to `recomputeRenewalDeadline()`
   * immediately above: called only on `createRegistration()`, never on
   * update (re-invoicing an existing registration just because its
   * `registrationNumber` was corrected would be wrong) — an application
   * fee is charged once, at the moment a registration is created.
   */
  private async createApplicationFeeInvoiceIfConfigured(
    actor: AuthenticatedUser,
    companyId: string,
    registration: ProductRegistration,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const authority = await tx.regulatoryAuthority.findUnique({
      where: { id: registration.authorityId },
    })
    if (!authority) return

    await this.regFeeLedgerService.createApplicationFeeInvoiceOnRegistration(
      companyId,
      registration.id,
      authority.countryId,
      registration.authorityId,
      registration.productClass ?? '*',
      actor.sub,
    )
  }
}
