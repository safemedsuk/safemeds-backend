import { NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { TrainingComplianceService } from './training-compliance.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
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
      if (value && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
        return (value as { in: unknown[] }).in.includes(row[key])
      }
      if (value && typeof value === 'object' && 'hasSome' in (value as Record<string, unknown>)) {
        const arr = (row[key] as unknown[]) ?? []
        return (value as { hasSome: unknown[] }).hasSome.some((v) => arr.includes(v))
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
    .mockImplementation(({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }) => {
      let matched = [...rows.values()].filter((r) => matches(r, where))
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0]
        matched = matched.sort((a, b) => {
          const av = a[field] as Date
          const bv = b[field] as Date
          return dir === 'desc' ? +bv - +av : +av - +bv
        })
      }
      return Promise.resolve(matched[0] ?? null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(({ where, select }: { where?: Record<string, unknown>; select?: unknown }) =>
      Promise.resolve(
        [...rows.values()].filter((r) => matches(r, where ?? {})).map((r) => (select ? r : r)),
      ),
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } | Record<string, unknown> }) => {
      if ('id' in where) return Promise.resolve(rows.get((where as { id: string }).id) ?? null)
      return Promise.resolve(null)
    })
  const deleteFn = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const existing = rows.get(where.id)
    rows.delete(where.id)
    return Promise.resolve(existing)
  })
  return { rows, create, findFirst, findMany, findUnique, delete: deleteFn }
}

function buildHarness() {
  const roleTrainingCurriculum = createTable<Row>()
  const trainingTypeCatalogEntry = createTable<Row>()
  const trainingRecord = createTable<Row>()
  const user = createTable<Row>()
  const competencyAssessment = createTable<Row>()
  const documentAcknowledgment = createTable<Row>()

  const tables = {
    roleTrainingCurriculum,
    trainingTypeCatalogEntry,
    trainingRecord,
    user,
    competencyAssessment,
    documentAcknowledgment,
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new TrainingComplianceService(rls as never, auditService)
  return { service, tables }
}

describe('TrainingComplianceService', () => {
  it('404s createCurriculum() against an unknown training type', async () => {
    const { service } = buildHarness()
    await expect(
      service.createCurriculum(actor, { roleKey: 'QUALITY_ASSOCIATE', trainingTypeId: 'missing' }, {}),
    ).rejects.toThrow(NotFoundException)
  })

  it('creates a curriculum row defaulting isMandatory to true', async () => {
    const { service, tables } = buildHarness()
    tables.trainingTypeCatalogEntry.rows.set('tt-1', { id: 'tt-1', typeKey: 'gmp_fundamentals', label: 'GMP Fundamentals' })
    const created = await service.createCurriculum(
      actor,
      { roleKey: 'QUALITY_ASSOCIATE', trainingTypeId: 'tt-1' },
      {},
    )
    expect(created.isMandatory).toBe(true)
  })

  it('getComplianceStatus() reports "missing" for a mandatory curriculum item with no training record', async () => {
    const { service, tables } = buildHarness()
    tables.user.rows.set('u1', { id: 'u1', companyId: 'company-1', roleKeys: ['QUALITY_ASSOCIATE'] })
    tables.trainingTypeCatalogEntry.rows.set('tt-1', { id: 'tt-1', typeKey: 'gmp_fundamentals', label: 'GMP Fundamentals' })
    tables.roleTrainingCurriculum.rows.set('c1', {
      id: 'c1',
      companyId: 'company-1',
      roleKey: 'QUALITY_ASSOCIATE',
      trainingTypeId: 'tt-1',
      trainingType: tables.trainingTypeCatalogEntry.rows.get('tt-1'),
      isMandatory: true,
    })

    const status = await service.getComplianceStatus(actor, 'u1')
    expect(status).toHaveLength(1)
    expect(status[0].status).toBe('missing')
  })

  it('getComplianceStatus() finds the latest training record and derives a real status', async () => {
    const { service, tables } = buildHarness()
    tables.user.rows.set('u1', { id: 'u1', companyId: 'company-1', roleKeys: ['QUALITY_ASSOCIATE'] })
    tables.trainingTypeCatalogEntry.rows.set('tt-1', { id: 'tt-1', typeKey: 'gmp_fundamentals', label: 'GMP Fundamentals' })
    tables.roleTrainingCurriculum.rows.set('c1', {
      id: 'c1',
      companyId: 'company-1',
      roleKey: 'QUALITY_ASSOCIATE',
      trainingTypeId: 'tt-1',
      trainingType: tables.trainingTypeCatalogEntry.rows.get('tt-1'),
      isMandatory: true,
    })
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 1)
    tables.trainingRecord.rows.set('tr-1', {
      id: 'tr-1',
      companyId: 'company-1',
      userId: 'u1',
      trainingType: 'gmp_fundamentals',
      completionDate: new Date('2026-01-01'),
      expiryDate: farFuture,
    })

    const status = await service.getComplianceStatus(actor, 'u1')
    expect(status[0].status).toBe('valid')
    expect(status[0].latestTrainingRecordId).toBe('tr-1')
  })

  it('rolloutForEffectiveSop() creates a DocumentAcknowledgment for every active user holding a matching role', async () => {
    const { service, tables } = buildHarness()
    tables.roleTrainingCurriculum.rows.set('c1', {
      id: 'c1',
      companyId: 'company-1',
      roleKey: 'QUALITY_ASSOCIATE',
      documentTypeTrigger: 'sop',
    })
    tables.user.rows.set('u1', { id: 'u1', companyId: 'company-1', status: 'active', roleKeys: ['QUALITY_ASSOCIATE'] })
    tables.user.rows.set('u2', { id: 'u2', companyId: 'company-1', status: 'active', roleKeys: ['QPPV'] })

    const sop = { id: 'sop-1', companyId: 'company-1', documentType: 'sop', currentVersion: 1 } as never
    const count = await service.rolloutForEffectiveSop(tables as never, 'company-1', sop)
    expect(count).toBe(1)
    expect(tables.documentAcknowledgment.rows.size).toBe(1)
  })

  it('rolloutForEffectiveSop() is a no-op for a document type with no curriculum trigger', async () => {
    const { service, tables } = buildHarness()
    const sop = { id: 'sop-1', companyId: 'company-1', documentType: 'policy', currentVersion: 1 } as never
    const count = await service.rolloutForEffectiveSop(tables as never, 'company-1', sop)
    expect(count).toBe(0)
  })

  it('records a competency assessment against a real training record', async () => {
    const { service, tables } = buildHarness()
    tables.trainingRecord.rows.set('tr-1', { id: 'tr-1', companyId: 'company-1' })
    const created = await service.recordCompetencyAssessment(
      actor,
      { trainingRecordId: 'tr-1', assessmentMethod: 'practical_observation', result: 'competent' },
      {},
    )
    expect(created.result).toBe('competent')
  })
})
