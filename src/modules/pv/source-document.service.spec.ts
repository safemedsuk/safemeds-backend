import { ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { SourceDocumentService } from './source-document.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['SUPERINTENDENT_PHARMACIST'],
  platformRole: null,
  tokenVersion: 1,
}

const platformActor: AuthenticatedUser = {
  sub: 'staff-1',
  companyId: null,
  roleKeys: [],
  platformRole: 'super_admin',
  tokenVersion: 1,
}

interface Row {
  id: string
  [key: string]: unknown
}

function createTable<T extends Row>() {
  const rows = new Map<string, T>()

  const seed = (row: T) => rows.set(row.id, row)
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    const row = { ...data, createdAt: new Date() } as T
    rows.set(row.id, row)
    return Promise.resolve(row)
  })
  const findFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const found = [...rows.values()].find((r) =>
        Object.entries(where).every(([k, v]) => v === undefined || r[k] === v),
      )
      return Promise.resolve(found ?? null)
    })
  const findMany = jest
    .fn()
    .mockImplementation(({ where }: { where?: Record<string, unknown> }) => {
      const list = [...rows.values()].filter((r) =>
        Object.entries(where ?? {}).every(([k, v]) => v === undefined || r[k] === v),
      )
      return Promise.resolve(list)
    })
  const update = jest
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Partial<T> }) => {
      const existing = rows.get(where.id)!
      const updated = { ...existing, ...data }
      rows.set(where.id, updated)
      return Promise.resolve(updated)
    })

  return { rows, seed, create, findFirst, findMany, update }
}

function buildHarness() {
  const tables = { case: createTable(), document: createTable(), sourceDocument: createTable() }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const service = new SourceDocumentService(rls as never, auditService)
  return { service, tables, auditLog }
}

describe('SourceDocumentService', () => {
  describe('link()', () => {
    it('links an existing, completed document to a case and audits it', async () => {
      const { service, tables, auditLog } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })

      const link = await service.link(actor, 'case-1', { documentId: 'doc-1' }, { ip: '9.9.9.9' })

      expect(link.caseId).toBe('case-1')
      expect(link.documentId).toBe('doc-1')
      expect(link.redactionApplied).toBe(false)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_source_document_linked', recordId: 'case-1' }),
      )
    })

    it('is idempotent — linking the same document twice returns the existing link, not a duplicate', async () => {
      const { service, tables } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })

      const first = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})
      const second = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})
      expect(second.id).toBe(first.id)
      expect(tables.sourceDocument.rows.size).toBe(1)
    })

    it('404s when the case does not exist in this company', async () => {
      const { service } = buildHarness()
      await expect(
        service.link(actor, 'missing-case', { documentId: 'doc-1' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s when the document was never uploaded against this case', async () => {
      const { service, tables } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      // Document exists, but registered against a different case.
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-2',
      })

      await expect(service.link(actor, 'case-1', { documentId: 'doc-1' }, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('rejects a platform-staff actor with no company context', async () => {
      const { service } = buildHarness()
      await expect(
        service.link(platformActor, 'case-1', { documentId: 'doc-1' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('markRedacted()', () => {
    it('flips redactionApplied and records redactedBy, once', async () => {
      const { service, tables, auditLog } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })
      const link = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})

      const redacted = await service.markRedacted(actor, link.id, {}, { ip: '1.1.1.1' })
      expect(redacted.redactionApplied).toBe(true)
      expect(redacted.redactedBy).toBe(actor.sub)
      expect(redacted.redactedAt).toBeInstanceOf(Date)
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'pv_source_document_redacted' }),
      )
    })

    it('is idempotent — redacting twice does not change redactedBy to a second actor', async () => {
      const { service, tables } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })
      const link = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})

      await service.markRedacted(actor, link.id, {}, {})
      const otherActor: AuthenticatedUser = { ...actor, sub: 'user-2' }
      const second = await service.markRedacted(otherActor, link.id, {}, {})
      expect(second.redactedBy).toBe(actor.sub)
    })

    it('404s for a source document link from another company', async () => {
      const { service, tables } = buildHarness()
      tables.sourceDocument.seed({
        id: 'link-1',
        companyId: 'company-2',
        caseId: 'case-1',
        documentId: 'doc-1',
        redactionApplied: false,
      })

      await expect(service.markRedacted(actor, 'link-1', {}, {})).rejects.toThrow(NotFoundException)
    })

    it('links a redacted-copy document distinct from the original when redactedDocumentId is provided', async () => {
      const { service, tables } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })
      tables.document.seed({
        id: 'doc-redacted',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })
      const link = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})

      const redacted = await service.markRedacted(
        actor,
        link.id,
        { redactedDocumentId: 'doc-redacted' },
        {},
      )

      expect(redacted.redactedDocumentId).toBe('doc-redacted')
      expect(redacted.documentId).toBe('doc-1')
    })

    it('404s when redactedDocumentId does not reference a document uploaded against this case', async () => {
      const { service, tables } = buildHarness()
      tables.case.seed({ id: 'case-1', companyId: 'company-1' })
      tables.document.seed({
        id: 'doc-1',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-1',
      })
      // Registered against a different case entirely.
      tables.document.seed({
        id: 'doc-wrong-case',
        companyId: 'company-1',
        recordType: 'pv_case',
        recordId: 'case-2',
      })
      const link = await service.link(actor, 'case-1', { documentId: 'doc-1' }, {})

      await expect(
        service.markRedacted(actor, link.id, { redactedDocumentId: 'doc-wrong-case' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
