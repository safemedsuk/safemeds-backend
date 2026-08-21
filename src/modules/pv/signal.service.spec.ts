import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SignalService } from './signal.service'

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
    return Object.entries(where).every(([key, value]) =>
      value === undefined ? true : row[key] === value,
    )
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
            (a, b) =>
              (new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime()) *
              (dir === 'desc' ? -1 : 1),
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
        include,
      }: {
        where?: Record<string, unknown>
        orderBy?: Record<string, 'asc' | 'desc'>
        include?: Record<string, unknown>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              (new Date(a[field] as string).getTime() - new Date(b[field] as string).getTime()) *
              (dir === 'desc' ? -1 : 1),
          )
        }
        if (include) {
          list = list.map((r) => ({ ...r }))
        }
        return Promise.resolve(list)
      },
    )
  const findUnique = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const [key, value] = Object.entries(where)[0]
      const flattened =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : { [key]: value }
      return Promise.resolve([...rows.values()].find((r) => matches(r, flattened)) ?? null)
    })
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const cleaned = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
      const updated = { ...existing, ...cleaned }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, findUnique, update }
}

function buildHarness(permissions: string[] = ['pv.manage_signals']) {
  const tables = {
    signal: createTable({ status: 'detected' }),
    signalCase: createTable(),
    case: createTable(),
    workflowInstance: createTable(),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditQuery = jest
    .fn()
    .mockResolvedValue({ data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } })
  const auditService = { log: auditLog, query: auditQuery } as never
  const getPermissionsForUser = jest.fn().mockResolvedValue(new Set(permissions))
  const rolesService = { getPermissionsForUser } as never
  const instantiate = jest.fn().mockResolvedValue({})
  const workflowService = { instantiate } as never

  const service = new SignalService(rls as never, auditService, rolesService, workflowService)
  return { service, tables, auditLog, auditQuery, instantiate }
}

function baseDto(overrides: Partial<Parameters<SignalService['create']>[1]> = {}) {
  return {
    title: 'Depo-Provera cluster',
    description: 'Batch pattern across two facilities',
    productIdentifier: 'Depo-Provera',
    ...overrides,
  }
}

describe('SignalService', () => {
  describe('create()', () => {
    it('creates a signal, instantiates its workflow, and audits it', async () => {
      const { service, tables, instantiate, auditLog } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})

      expect(signal.detectionMethod).toBe('manual')
      expect(signal.status).toBe('detected')
      expect(tables.signal.rows.size).toBe(1)
      expect(instantiate).toHaveBeenCalledWith(actor, 'signal', signal.id, null, {})
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'signal_raised' }),
      )
    })

    it('links any case IDs supplied at creation', async () => {
      const { service, tables } = buildHarness()
      tables.case.rows.set('case-1', {
        id: 'case-1',
        companyId: 'company-1',
        duplicateOfCaseId: null,
      })
      const signal = await service.create(actor, baseDto({ caseIds: ['case-1'] }), {})

      const links = [...tables.signalCase.rows.values()].filter((l) => l.signalId === signal.id)
      expect(links).toHaveLength(1)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, baseDto(), {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('testing-todo 17.2: stores an optional productId link and audits it, alongside the free-text productIdentifier', async () => {
      const { service, auditLog } = buildHarness()
      const signal = await service.create(actor, baseDto({ productId: 'product-1' }), {})

      expect(signal.productId).toBe('product-1')
      expect(signal.productIdentifier).toBe('Depo-Provera')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ newValue: expect.objectContaining({ productId: 'product-1' }) }),
      )
    })

    it('leaves productId null when the reporter typed a product freely with no catalog match', async () => {
      const { service } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      expect(signal.productId).toBeNull()
    })
  })

  describe('recordValidation()', () => {
    it('auto-computes the de-duplicated linked-case count as strength of evidence', async () => {
      const { service, tables } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})

      tables.case.rows.set('case-1', { id: 'case-1', duplicateOfCaseId: null })
      tables.case.rows.set('case-2', { id: 'case-2', duplicateOfCaseId: null })
      tables.case.rows.set('case-3', { id: 'case-3', duplicateOfCaseId: 'case-1' }) // a confirmed duplicate — must not inflate the count
      tables.signalCase.rows.set('link-1', {
        id: 'link-1',
        signalId: signal.id,
        caseId: 'case-1',
        case: tables.case.rows.get('case-1'),
      })
      tables.signalCase.rows.set('link-2', {
        id: 'link-2',
        signalId: signal.id,
        caseId: 'case-2',
        case: tables.case.rows.get('case-2'),
      })
      tables.signalCase.rows.set('link-3', {
        id: 'link-3',
        signalId: signal.id,
        caseId: 'case-3',
        case: tables.case.rows.get('case-3'),
      })

      const updated = await service.recordValidation(
        actor,
        signal.id,
        { previousAwareness: false },
        {},
      )
      expect(updated.strengthOfEvidenceCaseCount).toBe(2)
    })

    it('404s on an unknown signal', async () => {
      const { service } = buildHarness()
      await expect(service.recordValidation(actor, 'nonexistent', {}, {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('recordPrioritisation()/recordAssessment()/recordRecommendation()', () => {
    it('records prioritisation notes independent of lifecycle status', async () => {
      const { service } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      const updated = await service.recordPrioritisation(
        actor,
        signal.id,
        { severityNote: 'Hospitalisation reported in 2 of 3 cases' },
        {},
      )
      expect(updated.severityNote).toBe('Hospitalisation reported in 2 of 3 cases')
    })

    it('records an assessment note', async () => {
      const { service } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      const updated = await service.recordAssessment(
        actor,
        signal.id,
        { assessmentNote: 'Consistent with a genuine safety signal' },
        {},
      )
      expect(updated.assessmentNote).toBe('Consistent with a genuine safety signal')
    })

    it('records a recommendation action', async () => {
      const { service } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      const updated = await service.recordRecommendation(
        actor,
        signal.id,
        { recommendationAction: 'propose_product_info_update' },
        {},
      )
      expect(updated.recommendationAction).toBe('propose_product_info_update')
    })
  })

  describe('linkCases()', () => {
    it('links new cases and audits only when something new was actually linked', async () => {
      const { service, tables, auditLog } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      tables.case.rows.set('case-1', { id: 'case-1', duplicateOfCaseId: null })

      await service.linkCases(actor, signal.id, ['case-1'], {})
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'signal_cases_linked' }),
      )

      auditLog.mockClear()
      await service.linkCases(actor, signal.id, ['case-1'], {}) // re-linking the same case is a no-op
      expect(auditLog).not.toHaveBeenCalled()
    })
  })

  describe('list()/get() — read access', () => {
    it('rejects an actor with neither pv.manage_signals nor pv.view_all', async () => {
      const { service } = buildHarness([])
      await expect(service.list(actor)).rejects.toThrow(ForbiddenException)
    })

    it('allows a pv.view_all actor to read (but not necessarily manage)', async () => {
      const { service } = buildHarness(['pv.view_all'])
      await expect(service.list(actor)).resolves.toEqual([])
    })

    it('get() returns linked cases and the live workflow status', async () => {
      const { service, tables } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      tables.case.rows.set('case-1', {
        id: 'case-1',
        referenceNumber: 'PV-1',
        status: 'intake',
        duplicateOfCaseId: null,
      })
      tables.signalCase.rows.set('link-1', {
        id: 'link-1',
        signalId: signal.id,
        caseId: 'case-1',
        case: tables.case.rows.get('case-1'),
      })
      tables.workflowInstance.rows.set('wf-1', {
        id: 'wf-1',
        recordType: 'signal',
        recordId: signal.id,
        currentState: { stateKey: 'validated' },
      })

      const detail = await service.get(actor, signal.id)
      expect(detail.status).toBe('validated')
      expect(detail.linkedCases).toEqual([
        { id: 'case-1', referenceNumber: 'PV-1', status: 'intake', duplicateOfCaseId: null },
      ])
      expect(detail.transitionHistory).toEqual([])
      expect(detail.workflowInstanceId).toBe('wf-1')
    })

    it('get() 404s on an unknown signal', async () => {
      const { service } = buildHarness()
      await expect(service.get(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
    })

    it('get() surfaces transition history from the audit query', async () => {
      const { service, auditQuery } = buildHarness()
      const signal = await service.create(actor, baseDto(), {})
      auditQuery.mockResolvedValue({
        data: [
          {
            oldValue: { stateKey: 'detected' },
            newValue: {
              stateKey: 'validated',
              note: 'Confirmed against product info — not previously known.',
            },
            actorName: 'Dr QPPV',
            occurredAt: new Date('2026-01-01'),
          },
        ],
        meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
      })

      const detail = await service.get(actor, signal.id)
      expect(detail.transitionHistory).toEqual([
        {
          fromStateKey: 'detected',
          toStateKey: 'validated',
          note: 'Confirmed against product info — not previously known.',
          actorName: 'Dr QPPV',
          occurredAt: new Date('2026-01-01'),
        },
      ])
    })
  })
})
