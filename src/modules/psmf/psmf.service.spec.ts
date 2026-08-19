import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { PsmfService } from './psmf.service'

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
        orderBy?: Record<string, 'asc' | 'desc'>
      }) => {
        let list = [...rows.values()].filter((r) => matches(r, where ?? {}))
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) => (Number(a[field]) - Number(b[field])) * (dir === 'desc' ? -1 : 1),
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
  const findUniqueOrThrow = jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
    const found = rows.get(where.id)
    if (!found) throw new Error('not found')
    return Promise.resolve(found)
  })
  return { rows, create, findFirst, findMany, update, findUniqueOrThrow }
}

function buildHarness() {
  const tables = {
    psmf: createTable({ status: 'draft' }),
    document: createTable(),
    company: createTable(),
  }
  tables.company.rows.set('company-1', { id: 'company-1', name: 'Test Co' })
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const pdfService = { render: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')) }
  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'generated-doc-1' } })
  const documentsService = { uploadDirect } as never

  const service = new PsmfService(rls as never, auditService, pdfService as never, documentsService)
  return { service, tables, auditLog, pdfService, uploadDirect }
}

describe('PsmfService', () => {
  describe('create()', () => {
    it('creates the first draft at version 1', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'SafeMeds PSMF' }, {})
      expect(psmf.version).toBe(1)
      expect(psmf.status).toBe('draft')
      expect(tables.psmf.rows.size).toBe(1)
    })

    it('increments the version on a second draft', async () => {
      const { service } = buildHarness()
      await service.create(actor, { title: 'v1' }, {})
      const second = await service.create(actor, { title: 'v2' }, {})
      expect(second.version).toBe(2)
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, { title: 'x' }, {})).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  describe('attachDocument()', () => {
    it('attaches a document that belongs to this PSMF draft', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })

      const updated = await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      expect(updated.documentId).toBe('doc-1')
    })

    it('rejects a document not scoped to this PSMF', async () => {
      const { service } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      await expect(
        service.attachDocument(actor, psmf.id, { documentId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects attaching a document to a non-draft PSMF', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, psmf.id, {})

      tables.document.rows.set('doc-2', {
        id: 'doc-2',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await expect(
        service.attachDocument(actor, psmf.id, { documentId: 'doc-2' }, {}),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('updateContent()', () => {
    it('saves structured content on a draft', async () => {
      const { service } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      const content = { qppv: { primary: { fullName: 'Amara Wanjiru' } } }

      const updated = await service.updateContent(actor, psmf.id, { content }, {})
      expect(updated.content).toEqual(content)
    })

    it('rejects editing content on a non-draft PSMF', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, psmf.id, {})

      await expect(service.updateContent(actor, psmf.id, { content: {} }, {})).rejects.toThrow(
        ConflictException,
      )
    })
  })

  describe('generateDocument()', () => {
    it("renders a real PDF from the draft's own content and attaches it as documentId", async () => {
      const { service, pdfService, uploadDirect } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      const content = { qppv: { primary: { fullName: 'Amara Wanjiru' } } }
      await service.updateContent(actor, psmf.id, { content }, {})

      const updated = await service.generateDocument(actor, psmf.id, {})

      expect(pdfService.render).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: 'Test Co', content }),
      )
      expect(uploadDirect).toHaveBeenCalledWith(
        actor,
        'psmf',
        psmf.id,
        expect.anything(),
        expect.objectContaining({ title: expect.stringContaining('v1') }),
        {},
      )
      expect(updated.documentId).toBe('generated-doc-1')
    })

    it('rejects generating a document for a non-draft PSMF', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, psmf.id, {})

      await expect(service.generateDocument(actor, psmf.id, {})).rejects.toThrow(ConflictException)
    })
  })

  describe('activate()', () => {
    it('rejects activating a draft with no document attached', async () => {
      const { service } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      await expect(service.activate(actor, psmf.id, {})).rejects.toThrow(ConflictException)
    })

    it('activates a draft with a document attached', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})

      const activated = await service.activate(actor, psmf.id, {})
      expect(activated.status).toBe('active')
      expect(activated.activatedAt).toBeInstanceOf(Date)
    })

    it('retires the previously active version when a new one is activated', async () => {
      const { service, tables } = buildHarness()

      const v1 = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: v1.id,
      })
      await service.attachDocument(actor, v1.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, v1.id, {})

      const v2 = await service.create(actor, { title: 'v2' }, {})
      tables.document.rows.set('doc-2', {
        id: 'doc-2',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: v2.id,
      })
      await service.attachDocument(actor, v2.id, { documentId: 'doc-2' }, {})
      const activatedV2 = await service.activate(actor, v2.id, {})

      expect(activatedV2.status).toBe('active')
      const retiredV1 = tables.psmf.rows.get(v1.id)!
      expect(retiredV1.status).toBe('retired')
      expect(retiredV1.retiredAt).toBeInstanceOf(Date)
    })

    it('rejects re-activating an already-active/retired version', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, psmf.id, {})

      await expect(service.activate(actor, psmf.id, {})).rejects.toThrow(ConflictException)
    })

    it('404s on an unknown id', async () => {
      const { service } = buildHarness()
      await expect(service.activate(actor, 'nonexistent', {})).rejects.toThrow(NotFoundException)
    })
  })

  describe('getActive()', () => {
    it('returns null when no PSMF is active', async () => {
      const { service } = buildHarness()
      await expect(service.getActive('company-1')).resolves.toBeNull()
    })

    it('returns the active PSMF once activated', async () => {
      const { service, tables } = buildHarness()
      const psmf = await service.create(actor, { title: 'v1' }, {})
      tables.document.rows.set('doc-1', {
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'psmf',
        recordId: psmf.id,
      })
      await service.attachDocument(actor, psmf.id, { documentId: 'doc-1' }, {})
      await service.activate(actor, psmf.id, {})

      const active = await service.getActive('company-1')
      expect(active?.id).toBe(psmf.id)
    })
  })
})
