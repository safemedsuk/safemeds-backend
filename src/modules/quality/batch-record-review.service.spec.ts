import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { BatchRecordReviewService } from './batch-record-review.service'

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

function createTable<T extends Row>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>()
  function matches(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => value === undefined || row[key] === value)
  }
  const create = jest.fn().mockImplementation(({ data }: { data: T }) => {
    rows.set(data.id, { ...defaults, ...data })
    return Promise.resolve(rows.get(data.id))
  })
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
  const tables = { batchRecordReview: createTable(), batch: createTable(), document: createTable() }
  tables.batch.rows.set('batch-1', { id: 'batch-1', companyId: 'company-1', qualityStatus: 'quarantine' })
  tables.document.rows.set('doc-1', { id: 'doc-1', companyId: 'company-1' })
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const sign = jest.fn().mockResolvedValue({ id: 'signature-1' })
  const signatureService = { sign } as never

  const service = new BatchRecordReviewService(rls as never, auditService, signatureService)
  return { service, tables, auditLog, sign }
}

describe('BatchRecordReviewService', () => {
  describe('create()', () => {
    it('rejects a platform actor with no company', async () => {
      const { service } = buildHarness()
      await expect(service.create(noCompanyActor, { batchId: 'batch-1' }, {})).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('404s for a nonexistent batch', async () => {
      const { service } = buildHarness()
      await expect(service.create(actor, { batchId: 'nonexistent' }, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('404s for a nonexistent MBR document', async () => {
      const { service } = buildHarness()
      await expect(
        service.create(actor, { batchId: 'batch-1', mbrDocumentId: 'nonexistent' }, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('creates a review with no disposition yet, reviewer defaulting to the actor', async () => {
      const { service } = buildHarness()
      const created = await service.create(
        actor,
        { batchId: 'batch-1', mbrDocumentId: 'doc-1', reviewFindings: 'All checks pass' },
        {},
      )
      expect(created.reviewerUserId).toBe(actor.sub)
      expect(created.disposition).toBeFalsy()
    })
  })

  describe('recordDisposition()', () => {
    it('signs via SignatureService and sets the disposition + Batch.qualityStatus', async () => {
      const { service, tables, sign } = buildHarness()
      const review = await service.create(actor, { batchId: 'batch-1' }, {})
      const updated = await service.recordDisposition(
        actor,
        review.id,
        { disposition: 'released', intentStatement: 'I release this batch', signatureToken: 'tok-1' },
        {},
      )
      expect(updated.disposition).toBe('released')
      expect(updated.dispositionedAt).toBeInstanceOf(Date)
      expect(tables.batch.rows.get('batch-1')?.qualityStatus).toBe('released')
      expect(sign).toHaveBeenCalledWith(
        tables,
        actor,
        expect.objectContaining({
          recordType: 'batch_record_review',
          recordId: review.id,
          signatureToken: 'tok-1',
        }),
        {},
      )
    })

    it('rejects recording a second disposition on an already-dispositioned review', async () => {
      const { service } = buildHarness()
      const review = await service.create(actor, { batchId: 'batch-1' }, {})
      await service.recordDisposition(
        actor,
        review.id,
        { disposition: 'released', intentStatement: 'ok', signatureToken: 'tok-1' },
        {},
      )
      await expect(
        service.recordDisposition(
          actor,
          review.id,
          { disposition: 'rejected', intentStatement: 'ok', signatureToken: 'tok-2' },
          {},
        ),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects the batch on a rejected disposition', async () => {
      const { service, tables } = buildHarness()
      const review = await service.create(actor, { batchId: 'batch-1' }, {})
      await service.recordDisposition(
        actor,
        review.id,
        { disposition: 'rejected', intentStatement: 'ok', signatureToken: 'tok-1' },
        {},
      )
      expect(tables.batch.rows.get('batch-1')?.qualityStatus).toBe('rejected')
    })
  })

  describe('listForBatch()', () => {
    it('lists every review for a given batch, newest first', async () => {
      const { service } = buildHarness()
      await service.create(actor, { batchId: 'batch-1', reviewFindings: 'first' }, {})
      await service.create(actor, { batchId: 'batch-1', reviewFindings: 'second' }, {})
      const reviews = await service.listForBatch(actor, 'batch-1')
      expect(reviews).toHaveLength(2)
    })
  })
})
