import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { AuditPackService } from './audit-pack.service'

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

function createTable<T extends Row>() {
  const rows = new Map<string, T>()
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, data)
    return Promise.resolve(rows.get(data.id))
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        [...rows.values()].find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      ),
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
        let list = [...rows.values()].filter((r) =>
          Object.entries(where ?? {}).every(([k, v]) => r[k] === v),
        )
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
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const found = rows.get(where.id)
    if (!found) throw new Error('not found')
    return Promise.resolve(found)
  })
  return { rows, create, findFirst, findMany, findUniqueOrThrow }
}

function buildHarness() {
  const tables = { auditPack: createTable(), company: createTable() }
  tables.company.rows.set('company-1', { id: 'company-1', name: 'Acme Pharma' })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const dashboard = { overall: 'green' as const, readyCount: 15, totalMandatory: 15, rows: [] }
  const auditReadinessService = { getDashboard: jest.fn().mockResolvedValue(dashboard) } as never
  const pdfService = { render: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')) } as never
  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-pdf-1' } })
  const documentsService = { uploadDirect } as never

  const service = new AuditPackService(
    rls as never,
    auditService,
    auditReadinessService,
    pdfService,
    documentsService,
  )
  return { service, tables, auditLog, uploadDirect, dashboard }
}

describe('AuditPackService', () => {
  describe('generate()', () => {
    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.generate(noCompanyActor, {})).rejects.toThrow(ForbiddenException)
    })

    it('renders the PDF, uploads it, and archives a new AuditPack row', async () => {
      const { service, tables, uploadDirect, auditLog, dashboard } = buildHarness()

      const pack = await service.generate(actor, {})

      expect(uploadDirect).toHaveBeenCalledWith(
        actor,
        'audit_pack',
        pack.id,
        expect.objectContaining({ mimetype: 'application/pdf' }),
        expect.anything(),
        {},
      )
      expect(pack.pdfDocumentId).toBe('doc-pdf-1')
      expect(pack.snapshot).toEqual(dashboard)
      expect(tables.auditPack.rows.size).toBe(1)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'audit_pack_generated' }),
      )
    })

    it('archives a second generation as a separate row rather than overwriting the first', async () => {
      const { service, tables } = buildHarness()
      await service.generate(actor, {})
      await service.generate(actor, {})
      expect(tables.auditPack.rows.size).toBe(2)
    })
  })

  describe('list()/get()', () => {
    it('lists archived packs newest-first', async () => {
      const { service } = buildHarness()
      const first = await service.generate(actor, {})
      await new Promise((r) => setTimeout(r, 2))
      const second = await service.generate(actor, {})

      const list = await service.list(actor)
      expect(list.map((p) => p.id)).toEqual([second.id, first.id])
    })

    it('404s on an unknown pack id', async () => {
      const { service } = buildHarness()
      await expect(service.get(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
    })

    it('gets a real pack by id', async () => {
      const { service } = buildHarness()
      const pack = await service.generate(actor, {})
      const found = await service.get(actor, pack.id)
      expect(found.id).toBe(pack.id)
    })
  })
})
