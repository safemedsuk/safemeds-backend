import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RecallClosureGateService } from './recall-closure-gate.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['QUALITY_MANAGER'],
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

function createTable<T extends Row>(rowsInit: T[] = []) {
  const rows = new Map<string, T>(rowsInit.map((r) => [r.id, r]))
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      if (key === 'OR' && Array.isArray(value)) {
        return (value as Record<string, unknown>[]).some((clause) => matches(row, clause))
      }
      if (value !== null && typeof value === 'object' && 'in' in (value as Record<string, unknown>)) {
        return Array.isArray((value as { in: unknown[] }).in) && (value as { in: unknown[] }).in.includes(row[key])
      }
      return row[key] === value
    })
  }
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
    )
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
    )
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id)
      if (!row) throw new Error('not found')
      return Promise.resolve(row)
    })
  return { rows, findFirst, findMany, findUniqueOrThrow }
}

const RECALL_ID = 'recall-1'
const COUNTRY_ID = 'country-1'

function buildHarness(overrides: {
  recall?: Record<string, unknown>
  countries?: Row[]
  requirements?: Row[]
  discrepancies?: Row[]
  destructionRecords?: Row[]
  returnRecords?: Row[]
  effectivenessChecks?: Row[]
  capas?: Row[]
} = {}) {
  const tables = {
    recall: createTable([
      { id: RECALL_ID, companyId: 'company-1', rootCauseCapaId: null, ...overrides.recall },
    ]),
    recallCountry: createTable(
      overrides.countries ?? [
        { id: COUNTRY_ID, companyId: 'company-1', recallId: RECALL_ID, status: 'closure_submitted' },
      ],
    ),
    recallRequirement: createTable(overrides.requirements ?? []),
    recallDiscrepancy: createTable(overrides.discrepancies ?? []),
    recallDestructionRecord: createTable(overrides.destructionRecords ?? []),
    recallReturnRecord: createTable(overrides.returnRecords ?? []),
    recallEffectivenessCheck: createTable(overrides.effectivenessChecks ?? []),
    capa: createTable(overrides.capas ?? []),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const service = new RecallClosureGateService(rls as never)
  return { service, tables }
}

describe('RecallClosureGateService', () => {
  it('rejects a platform actor with no company', async () => {
    const { service } = buildHarness()
    await expect(service.check(noCompanyActor, RECALL_ID)).rejects.toThrow(ForbiddenException)
  })

  it('404s for a nonexistent recall', async () => {
    const { service } = buildHarness()
    await expect(service.check(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
  })

  it('passes all 8 gates for a fully clean recall with one closed-out country and a linked CAPA', async () => {
    const { service } = buildHarness({
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    const result = await service.check(actor, RECALL_ID)
    expect(result.allClear).toBe(true)
    expect(result.gates).toHaveLength(8)
    expect(result.gates.every((g) => g.passed)).toBe(true)
  })

  it('accepts the CAPA link via the pre-existing Recall.rootCauseCapaId pointer too, not only the sourceRecordType link', async () => {
    const { service } = buildHarness({
      recall: { rootCauseCapaId: 'capa-2' },
      capas: [{ id: 'capa-2', companyId: 'company-1', sourceRecordType: 'change_control', sourceRecordId: 'cc-1' }],
    })
    const result = await service.check(actor, RECALL_ID)
    const gate6 = result.gates.find((g) => g.gate === 6)!
    expect(gate6.passed).toBe(true)
  })

  it('Gate 1: fails when a blocksClosure requirement is still open', async () => {
    const { service } = buildHarness({
      requirements: [
        {
          id: 'req-1',
          companyId: 'company-1',
          recallCountryId: COUNTRY_ID,
          status: 'open',
          evidenceIds: [],
          recallRule: { evidenceTypes: [], blocksClosure: true },
        },
      ],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    const result = await service.check(actor, RECALL_ID)
    const gate1 = result.gates.find((g) => g.gate === 1)!
    expect(gate1.passed).toBe(false)
    expect(result.allClear).toBe(false)
  })

  it('Gate 1: a waived requirement counts as satisfied, not open', async () => {
    const { service } = buildHarness({
      requirements: [
        {
          id: 'req-1',
          companyId: 'company-1',
          recallCountryId: COUNTRY_ID,
          status: 'waived',
          evidenceIds: [],
          recallRule: { evidenceTypes: [], blocksClosure: true },
        },
      ],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    const result = await service.check(actor, RECALL_ID)
    expect(result.gates.find((g) => g.gate === 1)!.passed).toBe(true)
  })

  it('Gate 2: fails on an open blocking discrepancy, passes once resolved', async () => {
    const { service: blocked } = buildHarness({
      discrepancies: [{ id: 'disc-1', companyId: 'company-1', recallId: RECALL_ID, blocking: true, status: 'open' }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await blocked.check(actor, RECALL_ID)).gates.find((g) => g.gate === 2)!.passed).toBe(false)

    const { service: resolved } = buildHarness({
      discrepancies: [{ id: 'disc-1', companyId: 'company-1', recallId: RECALL_ID, blocking: true, status: 'resolved' }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await resolved.check(actor, RECALL_ID)).gates.find((g) => g.gate === 2)!.passed).toBe(true)
  })

  it('Gate 3: fails while a destruction record has no completion certificate', async () => {
    const { service } = buildHarness({
      destructionRecords: [{ id: 'dest-1', companyId: 'company-1', recallCountryId: COUNTRY_ID, status: 'destroyed' }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 3)!.passed).toBe(false)
  })

  it('Gate 4: fails while any return has no verdict', async () => {
    const { service } = buildHarness({
      returnRecords: [{ id: 'ret-1', companyId: 'company-1', recallId: RECALL_ID, verdict: null }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 4)!.passed).toBe(false)
  })

  it('Gate 5: fails while an effectiveness check is still open', async () => {
    const { service } = buildHarness({
      effectivenessChecks: [{ id: 'eff-1', companyId: 'company-1', recallCountryId: COUNTRY_ID, status: 'open' }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 5)!.passed).toBe(false)
  })

  it('Gate 6: fails when no recall-investigation CAPA has ever been linked', async () => {
    const { service } = buildHarness()
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 6)!.passed).toBe(false)
  })

  it('Gate 7: fails when a completed requirement whose rule names evidence types has none recorded', async () => {
    const { service } = buildHarness({
      requirements: [
        {
          id: 'req-1',
          companyId: 'company-1',
          recallCountryId: COUNTRY_ID,
          status: 'complete',
          evidenceIds: [],
          recallRule: { evidenceTypes: ['photo'], blocksClosure: false },
        },
      ],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 7)!.passed).toBe(false)
  })

  it('Gate 8: fails when zero countries have been added to the recall at all (never vacuously green)', async () => {
    const { service } = buildHarness({
      countries: [],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    const result = await service.check(actor, RECALL_ID)
    const gate8 = result.gates.find((g) => g.gate === 8)!
    expect(gate8.passed).toBe(false)
    expect(gate8.reason).toMatch(/no country has been added/i)
  })

  it('Gate 8: fails when a country has not yet reached closure_submitted', async () => {
    const { service } = buildHarness({
      countries: [{ id: COUNTRY_ID, companyId: 'company-1', recallId: RECALL_ID, status: 'in_progress' }],
      capas: [{ id: 'capa-1', companyId: 'company-1', sourceRecordType: 'recall_investigation', sourceRecordId: RECALL_ID }],
    })
    expect((await service.check(actor, RECALL_ID)).gates.find((g) => g.gate === 8)!.passed).toBe(false)
  })
})
