import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { DEFAULT_STABILITY_TIMEPOINT_MONTHS, StabilityService } from './stability.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_ASSOCIATE'],
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
      if (key === 'id' && value && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
        return (value as { in: string[] }).in.includes(row.id)
      }
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
    return Promise.resolve(rows.get(data.id))
  })
  const createMany = jest.fn().mockImplementation(({ data }: { data: T[] }) => {
    for (const d of data) rows.set(d.id, { ...defaults, ...d })
    return Promise.resolve({ count: data.length })
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where, include }: { where?: Record<string, unknown>; include?: unknown }) => {
      const matched = [...rows.values()].filter((r) => matches(r, where ?? {}))
      if (include && (include as Record<string, unknown>).timepoints) {
        return Promise.resolve(matched)
      }
      return Promise.resolve(matched)
    })
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, createMany, findFirst, findMany, update }
}

function buildHarness() {
  const product = createTable<Row>()
  product.rows.set('product-1', { id: 'product-1', companyId: 'company-1' })
  const stabilityStudy = createTable<Row>()
  const stabilityTimepoint = createTable<Row>()
  const specificationParameter = createTable<Row>()
  specificationParameter.rows.set('param-1', {
    id: 'param-1',
    parameterName: 'Assay',
    lowerLimit: '95',
    upperLimit: '105',
  })

  // Override findMany on stabilityStudy to attach timepoints for `.get()`/`summarizeForPqr`-style includes.
  const originalFindMany = stabilityStudy.findMany
  stabilityStudy.findMany = jest.fn().mockImplementation(async (args: Record<string, unknown>) => {
    const studies = await originalFindMany(args)
    return (studies as Row[]).map((s) => ({
      ...s,
      timepoints: [...stabilityTimepoint.rows.values()].filter((t) => t.stabilityStudyId === s.id),
    }))
  })
  const originalFindFirst = stabilityStudy.findFirst
  stabilityStudy.findFirst = jest.fn().mockImplementation(async (args: Record<string, unknown>) => {
    const s = (await originalFindFirst(args)) as Row | null
    if (!s) return null
    return {
      ...s,
      timepoints: [...stabilityTimepoint.rows.values()]
        .filter((t) => t.stabilityStudyId === s.id)
        .sort((a, b) => (a.timepointMonths as number) - (b.timepointMonths as number)),
    }
  })

  const tables = { product, stabilityStudy, stabilityTimepoint, specificationParameter }
  const rls = { runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables) }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new StabilityService(rls as never, auditService)
  return { service, tables }
}

describe('StabilityService', () => {
  it('404s against a product that does not exist', async () => {
    const { service } = buildHarness()
    await expect(
      service.createStudy(actor, { productId: 'nope', storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('seeds the full ICH Q1A(R2) default timepoint schedule on study creation', async () => {
    const { service, tables } = buildHarness()
    const study = await service.createStudy(
      actor,
      { productId: 'product-1', storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01' },
      {},
    )
    const timepoints = [...tables.stabilityTimepoint.rows.values()].filter((t) => t.stabilityStudyId === study.id)
    expect(timepoints).toHaveLength(DEFAULT_STABILITY_TIMEPOINT_MONTHS.length)
    expect(timepoints.map((t) => t.timepointMonths).sort((a, b) => (a as number) - (b as number))).toEqual(
      DEFAULT_STABILITY_TIMEPOINT_MONTHS,
    )
  })

  it('records a within-spec result and flips the timepoint to results_recorded', async () => {
    const { service, tables } = buildHarness()
    const study = await service.createStudy(
      actor,
      { productId: 'product-1', storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01', timepointMonths: [0] },
      {},
    )
    const timepoint = [...tables.stabilityTimepoint.rows.values()].find((t) => t.stabilityStudyId === study.id)!
    const updated = await service.recordResults(
      actor,
      timepoint.id,
      { pullDate: '2026-01-02', results: [{ parameterId: 'param-1', result: '100' }] },
      {},
    )
    expect(updated.status).toBe('results_recorded')
    expect(updated.withinSpec).toBe(true)
  })

  it('flags an out-of-spec result', async () => {
    const { service, tables } = buildHarness()
    const study = await service.createStudy(
      actor,
      { productId: 'product-1', storageCondition: 'long_term_30c_75rh', startDate: '2026-01-01', timepointMonths: [0] },
      {},
    )
    const timepoint = [...tables.stabilityTimepoint.rows.values()].find((t) => t.stabilityStudyId === study.id)!
    const updated = await service.recordResults(
      actor,
      timepoint.id,
      { pullDate: '2026-01-02', results: [{ parameterId: 'param-1', result: '80' }] },
      {},
    )
    expect(updated.withinSpec).toBe(false)
  })

  it('summarizes "not yet applicable" for a product with no stability study', async () => {
    const { service } = buildHarness()
    const summary = await service.summarizeForPqr('company-1', 'product-1')
    expect(summary.studyCount).toBe(0)
    expect(summary.stabilityNote).toContain('Not yet applicable')
  })
})
