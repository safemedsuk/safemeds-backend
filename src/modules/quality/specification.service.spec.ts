import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SpecificationService } from './specification.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
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

interface SpecRow {
  id: string
  companyId: string
  specificationNumber: string
  title: string
  specificationType: string
  productId: string | null
  supplierId: string | null
  status: string
  [key: string]: unknown
}
interface ParamRow {
  id: string
  specificationId: string
  parameterName: string
  sortOrder: number
  [key: string]: unknown
}

/**
 * A bespoke (not the generic flat-table) mock — `SpecificationService`
 * does real Prisma nested writes (`parameters: { create: [...] }`) and
 * `include: { parameters: true }` reads, which a plain flat-row table
 * mock can't represent faithfully.
 */
function buildHarness() {
  const specRows = new Map<string, SpecRow>()
  const paramRows = new Map<string, ParamRow>()

  function attachParams(spec: SpecRow) {
    const params = [...paramRows.values()]
      .filter((p) => p.specificationId === spec.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return { ...spec, parameters: params }
  }

  function matchesWhere(row: SpecRow, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return true // not exercised by these tests
      if (value === undefined) return true
      return row[key] === value
    })
  }

  const create = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const { parameters, ...rest } = data
    const spec = rest as unknown as SpecRow
    specRows.set(spec.id, spec)
    const nested = (parameters as { create?: ParamRow[] } | undefined)?.create ?? []
    for (const p of nested) {
      paramRows.set(p.id, { ...p, specificationId: spec.id })
    }
    return Promise.resolve(attachParams(spec))
  })

  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const found = [...specRows.values()].find((r) => matchesWhere(r, where))
      return Promise.resolve(found ? attachParams(found) : null)
    })

  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(
        [...specRows.values()].filter((r) => matchesWhere(r, where ?? {})).map(attachParams),
      ),
    )

  const count = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...specRows.values()].filter((r) => matchesWhere(r, where ?? {})).length),
    )

  const update = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = specRows.get(where.id)!
        const { parameters, ...rest } = data
        const cleaned = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
        const updated = { ...existing, ...cleaned }
        specRows.set(where.id, updated)
        const nested = (parameters as { create?: ParamRow[] } | undefined)?.create
        if (nested) {
          for (const p of nested) {
            paramRows.set(p.id, { ...p, specificationId: updated.id })
          }
        }
        return Promise.resolve(attachParams(updated))
      },
    )

  const specification = { create, findFirst, findMany, count, update }
  const specificationParameter = {
    deleteMany: jest
      .fn()
      .mockImplementation(({ where }: { where: { specificationId: string } }) => {
        for (const [id, p] of paramRows) {
          if (p.specificationId === where.specificationId) paramRows.delete(id)
        }
        return Promise.resolve({ count: 0 })
      }),
  }

  const tables = { specification, specificationParameter }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new SpecificationService(rls as never, auditService)
  return { service, specRows, paramRows, auditLog }
}

describe('SpecificationService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(
      service.create(
        noCompanyActor,
        {
          specificationNumber: 'SPEC-001',
          title: 'Paracetamol 500mg',
          specificationType: 'finished_product',
        },
        {},
      ),
    ).rejects.toThrow(ForbiddenException)
  })

  it('creates a specification with structured parameters in one write', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      {
        specificationNumber: 'SPEC-001',
        title: 'Paracetamol 500mg',
        specificationType: 'finished_product',
        parameters: [
          {
            parameterName: 'Assay',
            testMethod: 'HPLC',
            lowerLimit: '95',
            upperLimit: '105',
            unit: '%',
          },
          { parameterName: 'Appearance', lowerLimit: 'White tablet' },
        ],
      },
      {},
    )
    expect(created.status).toBe('draft')
    expect(created.parameters).toHaveLength(2)
    expect(created.parameters[0].parameterName).toBe('Assay')
  })

  it('rejects a duplicate specificationNumber', async () => {
    const { service } = buildHarness()
    await service.create(
      actor,
      { specificationNumber: 'SPEC-001', title: 'x', specificationType: 'finished_product' },
      {},
    )
    await expect(
      service.create(
        actor,
        { specificationNumber: 'SPEC-001', title: 'y', specificationType: 'raw_material' },
        {},
      ),
    ).rejects.toThrow(ConflictException)
  })

  it('404s updating a nonexistent specification', async () => {
    const { service } = buildHarness()
    await expect(service.update(actor, 'nonexistent', { title: 'x' }, {})).rejects.toThrow(
      NotFoundException,
    )
  })

  it('replacing parameters on update() deletes the old set and creates the new one', async () => {
    const { service } = buildHarness()
    const created = await service.create(
      actor,
      {
        specificationNumber: 'SPEC-001',
        title: 'x',
        specificationType: 'finished_product',
        parameters: [{ parameterName: 'Assay' }],
      },
      {},
    )
    const updated = await service.update(
      actor,
      created.id,
      { parameters: [{ parameterName: 'Dissolution' }, { parameterName: 'Hardness' }] },
      {},
    )
    expect(updated.parameters).toHaveLength(2)
    expect(updated.parameters.map((p) => p.parameterName)).toEqual(['Dissolution', 'Hardness'])
  })

  it('refuses to edit a specification that has left draft', async () => {
    const { service, specRows } = buildHarness()
    const created = await service.create(
      actor,
      { specificationNumber: 'SPEC-001', title: 'x', specificationType: 'finished_product' },
      {},
    )
    specRows.set(created.id, { ...specRows.get(created.id)!, status: 'effective' })
    await expect(service.update(actor, created.id, { title: 'y' }, {})).rejects.toThrow(
      ConflictException,
    )
  })
})
