import { ConflictException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ValidationService } from './validation.service'

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

const sopByDocumentId = new Map<string, { id: string; status: string }>()

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true
      return row[key] === value
    })
  }
  const create = jest.fn().mockImplementation(({ data, include }: { data: T; include?: unknown }) => {
    rows.set(data.id, { ...defaults, createdAt: new Date(), ...data })
    const row = rows.get(data.id)!
    return Promise.resolve(include ? { ...row, protocolDocument: sopByDocumentId.get(row.protocolDocumentId as string) } : row)
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
      const row = [...rows.values()].find((r) => matches(r, where)) ?? null
      if (!row) return Promise.resolve(null)
      return Promise.resolve(
        include ? { ...row, protocolDocument: sopByDocumentId.get(row.protocolDocumentId as string) } : row,
      )
    })
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].filter((r) => matches(r, where ?? {}))),
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
  return { rows, create, findFirst, findMany, count, update }
}

function buildHarness(sopStatus = 'draft') {
  sopByDocumentId.clear()
  const tables = {
    validationProtocol: createTable(),
    validationReport: createTable(),
    document: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  let sopCounter = 0
  const sopCreate = jest.fn().mockImplementation(() => {
    sopCounter += 1
    const sop = { id: `sop-${sopCounter}`, status: sopStatus }
    sopByDocumentId.set(sop.id, sop)
    return Promise.resolve(sop)
  })
  const sopService = { create: sopCreate } as never

  const service = new ValidationService(rls as never, auditService, sopService)
  return { service, tables, auditLog, sopCreate }
}

describe('ValidationService', () => {
  it('createProtocol() creates the backing Sop via SopService then the protocol row', async () => {
    const { service, sopCreate } = buildHarness()
    const created = await service.createProtocol(
      actor,
      {
        title: 'Cleaning Validation — Line 1',
        validationType: 'cleaning',
        documentNumber: 'VAL-CLN-001',
      },
      {},
    )
    expect(sopCreate).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ documentType: 'protocol', documentNumber: 'VAL-CLN-001' }),
      {},
    )
    expect(created.protocolDocumentId).toBe('sop-1')
    expect(created.validationType).toBe('cleaning')
  })

  it('only stores approach for process validations, and gampCategory for computer_system', async () => {
    const { service } = buildHarness()
    const process = await service.createProtocol(
      actor,
      {
        title: 'Process Validation',
        validationType: 'process',
        approach: 'traditional_three_batch',
        gampCategory: '5_custom',
        documentNumber: 'VAL-PRC-001',
      },
      {},
    )
    expect(process.approach).toBe('traditional_three_batch')
    expect(process.gampCategory).toBeNull()

    const csv = await service.createProtocol(
      actor,
      {
        title: 'CSV — LIMS',
        validationType: 'computer_system',
        approach: 'traditional_three_batch',
        gampCategory: '4_configured',
        documentNumber: 'VAL-CSV-001',
      },
      {},
    )
    expect(csv.gampCategory).toBe('4_configured')
    expect(csv.approach).toBeNull()
  })

  it('createReport() is blocked until the protocol document is effective', async () => {
    const { service } = buildHarness('draft')
    const protocol = await service.createProtocol(
      actor,
      { title: 'Analytical Method', validationType: 'analytical_method', documentNumber: 'VAL-AM-001' },
      {},
    )
    await expect(service.createReport(actor, protocol.id, {}, {})).rejects.toThrow(ConflictException)
  })

  it('createReport() succeeds once the protocol document is effective, and finalize() sets the conclusion', async () => {
    const { service } = buildHarness('effective')
    const protocol = await service.createProtocol(
      actor,
      { title: 'Analytical Method', validationType: 'analytical_method', documentNumber: 'VAL-AM-002' },
      {},
    )
    const report = await service.createReport(actor, protocol.id, { conclusion: 'validated' }, {})
    expect(report.conclusion).toBe('validated')

    const finalized = await service.finalizeReport(actor, report.id, { conclusion: 'conditionally_validated' }, {})
    expect(finalized.conclusion).toBe('conditionally_validated')
  })

  it('404s on a nonexistent protocol', async () => {
    const { service } = buildHarness()
    await expect(service.getProtocol(actor, 'missing')).rejects.toThrow(NotFoundException)
  })
})
