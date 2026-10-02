import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RiskManagementPlanService } from './risk-management-plan.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QPPV'],
  platformRole: null,
  tokenVersion: 1,
}
const noCompanyActor: AuthenticatedUser = {
  sub: 'user-2',
  companyId: null,
  roleKeys: [],
  platformRole: null,
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (
        value !== null &&
        typeof value === 'object' &&
        'lte' in (value as Record<string, unknown>)
      ) {
        const rowValue = row[key]
        return (
          rowValue !== null &&
          rowValue !== undefined &&
          (rowValue as Date) <= (value as { lte: Date }).lte
        )
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        'equals' in (value as Record<string, unknown>)
      ) {
        const clause = value as { equals: string; mode?: string }
        const rowValue = typeof row[key] === 'string' ? (row[key]) : ''
        return clause.mode === 'insensitive'
          ? rowValue.toLowerCase() === clause.equals.toLowerCase()
          : rowValue === clause.equals
      }
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list[0] ?? null)
      },
    )
  const findMany = jest
    .fn()
    .mockImplementation(
      ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>[] | Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        const orderings = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : []
        for (const ordering of [...orderings].reverse()) {
          const [field, dir] = Object.entries(ordering)[0]
          list = [...list].sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
          )
        }
        return Promise.resolve(list)
      },
    )
  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {})).length),
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const found = rows.get(where.id)
    if (!found) throw new Error('not found')
    return Promise.resolve(found)
  })
  return { rows, create, findFirst, findMany, count, update, findUniqueOrThrow }
}

function buildHarness() {
  const tables = {
    riskManagementPlan: createTable({ status: 'draft' }),
    product: createTable(),
    document: createTable(),
    company: createTable(),
  }
  tables.company.rows.set('company-1', { id: 'company-1', name: 'Nairobi Vigil Labs' })
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
  const pdfService = { render } as never

  const uploadDirect = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-generated' }, version: { id: 'ver-1' } })
  const documentsService = { uploadDirect } as never

  const service = new RiskManagementPlanService(
    rls as never,
    auditService,
    pdfService,
    documentsService,
  )
  return { service, tables, auditLog, render, uploadDirect }
}

describe('RiskManagementPlanService', () => {
  describe('create()', () => {
    it('creates the first draft at version 1 for a real product', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })

      const rmp = await service.create(actor, { productId: 'product-1', title: 'RMP v1' }, {})
      expect(rmp.version).toBe(1)
      expect(rmp.status).toBe('draft')
    })

    it('increments the version on a second draft for the same product', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })

      await service.create(actor, { productId: 'product-1', title: 'v1' }, {})
      const second = await service.create(actor, { productId: 'product-1', title: 'v2' }, {})
      expect(second.version).toBe(2)
    })

    it('keeps two different products on independent version sequences', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      tables.product.rows.set('product-2', { id: 'product-2', companyId: 'company-1' })

      await service.create(actor, { productId: 'product-1', title: 'p1v1' }, {})
      const otherProductFirst = await service.create(
        actor,
        { productId: 'product-2', title: 'p2v1' },
        {},
      )
      expect(otherProductFirst.version).toBe(1)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(noCompanyActor, { productId: 'product-1', title: 'x' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })

    it('404s on an unknown product', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, { productId: 'nonexistent', title: 'x' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('attachDocument() / activate()', () => {
    it('activates a draft with a document attached, and retires the previously active version for that product only', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      tables.product.rows.set('product-2', { id: 'product-2', companyId: 'company-1' })

      const v1 = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'risk_management_plan',
        recordId: v1.id,
      })
      await service.attachDocument(actor, v1.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, v1.id, {})

      // A second product's own first version activates independently — no cross-product interference.
      const otherProduct = await service.create(
        actor,
        { productId: 'product-2', title: 'other' },
        {},
      )
      tables.document.rows.set('doc-other', {
        id: 'doc-other',
        companyId: 'company-1',
        recordType: 'risk_management_plan',
        recordId: otherProduct.id,
      })
      await service.attachDocument(actor, otherProduct.id, { documentId: 'doc-other' }, {})
      const activatedOther = await service.activate(actor, otherProduct.id, {})
      expect(activatedOther.status).toBe('active')
      expect(tables.riskManagementPlan.rows.get(v1.id)!.status).toBe('active')

      const v2 = await service.create(actor, { productId: 'product-1', title: 'v2' }, {})
      tables.document.rows.set('doc-2', {
        id: 'doc-2',
        companyId: 'company-1',
        recordType: 'risk_management_plan',
        recordId: v2.id,
      })
      await service.attachDocument(actor, v2.id, { documentId: 'doc-2' }, {})
      const activatedV2 = await service.activate(actor, v2.id, {})

      expect(activatedV2.status).toBe('active')
      expect(tables.riskManagementPlan.rows.get(v1.id)!.status).toBe('retired')
      // Product 2's active version is untouched by product 1's new activation.
      expect(tables.riskManagementPlan.rows.get(otherProduct.id)!.status).toBe('active')
    })

    it('rejects activating a draft with no document attached', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      const rmp = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})
      await expect(service.activate(actor, rmp.id, {})).rejects.toThrow(ConflictException)
    })
  })

  describe('updateRenewal()', () => {
    it('updates the renewal date regardless of status', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      const rmp = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})

      const updated = await service.updateRenewal(
        actor,
        rmp.id,
        { nextRenewalDueAt: '2027-01-01' },
        {},
      )
      expect(updated.nextRenewalDueAt).toEqual(new Date('2027-01-01'))
    })

    it('404s on an unknown RMP', async () => {
      const { service } = buildHarness()
      await expect(
        service.updateRenewal(actor, 'nonexistent', { nextRenewalDueAt: '2027-01-01' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('updateContent() / generateDocument() — real-document-fidelity request, 12 Sep 2026', () => {
    it('saves structured content on a draft', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      const rmp = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})

      const updated = await service.updateContent(
        actor,
        rmp.id,
        { content: { partVI: { summary: 'A real summary.' } } },
        {},
      )
      expect((updated.content as Record<string, unknown>).partVI).toEqual({
        summary: 'A real summary.',
      })
    })

    it('rejects updating content on a non-draft RMP', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
      const rmp = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'risk_management_plan',
        recordId: rmp.id,
      })
      await service.attachDocument(actor, rmp.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, rmp.id, {})

      await expect(service.updateContent(actor, rmp.id, { content: {} }, {})).rejects.toThrow(
        ConflictException,
      )
    })

    it('renders a PDF from saved content and attaches it as the RMP document', async () => {
      const { service, tables, render, uploadDirect } = buildHarness()
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Amoxiclav 625mg',
      })
      const rmp = await service.create(actor, { productId: 'product-1', title: 'v1' }, {})
      await service.updateContent(
        actor,
        rmp.id,
        { content: { partVI: { summary: 'Summary text.' } } },
        {},
      )

      const generated = await service.generateDocument(actor, rmp.id, {})

      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          productBrandName: 'Amoxiclav 625mg',
          content: expect.objectContaining({ partVI: { summary: 'Summary text.' } }),
        }),
      )
      expect(uploadDirect).toHaveBeenCalled()
      expect(generated.documentId).toBe('doc-generated')
    })

    it('404s generating a document for an unknown RMP', async () => {
      const { service } = buildHarness()
      await expect(service.generateDocument(actor, 'nonexistent', {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('countRenewalsDue()', () => {
    it('counts only active RMPs due within 90 days', async () => {
      const { service, tables } = buildHarness()
      const soon = new Date()
      soon.setDate(soon.getDate() + 30)
      const far = new Date()
      far.setDate(far.getDate() + 400)

      tables.riskManagementPlan.rows.set('rmp-1', {
        id: 'rmp-1',
        companyId: 'company-1',
        status: 'active',
        nextRenewalDueAt: soon,
      })
      tables.riskManagementPlan.rows.set('rmp-2', {
        id: 'rmp-2',
        companyId: 'company-1',
        status: 'active',
        nextRenewalDueAt: far,
      })
      tables.riskManagementPlan.rows.set('rmp-3', {
        id: 'rmp-3',
        companyId: 'company-1',
        status: 'draft',
        nextRenewalDueAt: soon,
      })

      await expect(service.countRenewalsDue('company-1')).resolves.toBe(1)
    })
  })

  describe('findProductByBrandName() (real-usage request, 22 Sep 2026, item 8)', () => {
    it('matches a real, active product by brand name, case-insensitively', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Amoxil',
        isActive: true,
      })

      const found = await service.findProductByBrandName(actor, 'amoxil')
      expect(found?.id).toBe('product-1')
    })

    it('returns null for a product that does not exist', async () => {
      const { service } = buildHarness()
      const found = await service.findProductByBrandName(actor, 'Does Not Exist')
      expect(found).toBeNull()
    })

    it('never matches a deactivated product', async () => {
      const { service, tables } = buildHarness()
      tables.product.rows.set('product-1', {
        id: 'product-1',
        companyId: 'company-1',
        brandName: 'Withdrawn Item',
        isActive: false,
      })

      const found = await service.findProductByBrandName(actor, 'Withdrawn Item')
      expect(found).toBeNull()
    })
  })
})
