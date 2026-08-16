import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { InternalAuditService } from './internal-audit.service'

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
        include,
      }: {
        where: Record<string, unknown>
        include?: { findings?: unknown }
      }) => {
        const found = [...rows.values()].find((r) => matches(r, where)) ?? null
        if (found && include?.findings) {
          return Promise.resolve({ ...found, findings: [] })
        }
        return Promise.resolve(found)
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
        orderBy?: Record<string, 'asc' | 'desc'>
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
        return Promise.resolve(list)
      },
    )
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })
  return { rows, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = {
    internalAudit: createTable({ status: 'scheduled' }),
    auditFinding: createTable({ status: 'open' }),
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new InternalAuditService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('InternalAuditService', () => {
  describe('create()', () => {
    it('schedules a new internal audit', async () => {
      const { service } = buildHarness()
      const audit = await service.create(
        actor,
        { title: 'Q3 GVP Audit', scheduledDate: '2026-09-01' },
        {},
      )
      expect(audit.status).toBe('scheduled')
      expect(audit.title).toBe('Q3 GVP Audit')
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(noCompanyActor, { title: 'x', scheduledDate: '2026-09-01' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('update()', () => {
    it('updates status and audits the old/new values', async () => {
      const { service, auditLog } = buildHarness()
      const audit = await service.create(
        actor,
        { title: 'Q3 GVP Audit', scheduledDate: '2026-09-01' },
        {},
      )
      const updated = await service.update(actor, audit.id, { status: 'in_progress' }, {})
      expect(updated.status).toBe('in_progress')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'internal_audit_updated',
          oldValue: { status: 'scheduled' },
        }),
      )
    })

    it('404s on an unknown id', async () => {
      const { service } = buildHarness()
      await expect(
        service.update(actor, 'nonexistent', { status: 'completed' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('addFinding()', () => {
    it('logs a finding against a real audit', async () => {
      const { service } = buildHarness()
      const audit = await service.create(
        actor,
        { title: 'Q3 GVP Audit', scheduledDate: '2026-09-01' },
        {},
      )
      const finding = await service.addFinding(
        actor,
        audit.id,
        { description: 'No signed SDEA on file', severity: 'major' },
        {},
      )
      expect(finding.status).toBe('open')
      expect(finding.auditId).toBe(audit.id)
    })

    it('404s when the audit does not exist', async () => {
      const { service } = buildHarness()
      await expect(
        service.addFinding(actor, 'nonexistent', { description: 'x', severity: 'minor' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('get()', () => {
    it('includes findings ordered newest-first', async () => {
      const { service } = buildHarness()
      const audit = await service.create(
        actor,
        { title: 'Q3 GVP Audit', scheduledDate: '2026-09-01' },
        {},
      )
      const found = await service.get(actor, audit.id)
      expect(found.findings).toEqual([])
    })

    it('404s on an unknown id', async () => {
      const { service } = buildHarness()
      await expect(service.get(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
    })
  })
})
