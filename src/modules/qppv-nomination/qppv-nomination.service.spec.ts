import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { QppvNominationService } from './qppv-nomination.service'

const actor: AuthenticatedUser = {
  sub: 'admin-1',
  companyId: 'company-1',
  roleKeys: ['SYSTEM_ADMINISTRATOR'],
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
    .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve([...rows.values()].find((r) => matches(r, where)) ?? null),
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
          const [field] = Object.entries(orderBy)[0]
          list = list.sort(
            (a, b) =>
              new Date(b[field] as string).getTime() - new Date(a[field] as string).getTime(),
          )
        }
        return Promise.resolve(list)
      },
    )
  const findUniqueOrThrow = jest
    .fn()
    .mockImplementation(
      ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const found = [...rows.values()].find((r) => matches(r, where))
        if (!found) throw new Error('not found')
        if (select) {
          const picked: Row = { id: found.id }
          for (const k of Object.keys(select)) picked[k] = found[k]
          return Promise.resolve(picked)
        }
        return Promise.resolve(found)
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
  return { rows, create, findFirst, findMany, findUniqueOrThrow, update }
}

function buildHarness() {
  const tables = {
    company: createTable({ primaryQppvUserId: null, backupQppvUserId: null }),
    user: createTable(),
    qppvNomination: createTable({ status: 'active' }),
    document: createTable(),
  }
  tables.company.rows.set('company-1', {
    id: 'company-1',
    name: 'Acme Pharma',
    registeredAddress: null,
    regulatoryContactEmail: null,
    primaryQppvUserId: null,
    backupQppvUserId: null,
  })
  tables.user.rows.set('qppv-1', {
    id: 'qppv-1',
    companyId: 'company-1',
    fullName: 'Dr. Amina',
    roleKeys: ['QPPV'],
  })
  tables.user.rows.set('qppv-2', {
    id: 'qppv-2',
    companyId: 'company-1',
    fullName: 'Dr. Otieno',
    roleKeys: ['QPPV'],
  })
  tables.user.rows.set('non-qppv', {
    id: 'non-qppv',
    companyId: 'company-1',
    fullName: 'Not QPPV',
    roleKeys: ['QUALITY_ASSOCIATE'],
  })

  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
  }
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never
  const uploadDirect = jest.fn().mockResolvedValue({ document: { id: 'doc-letter-1' } })
  const documentsService = { uploadDirect } as never
  const pdfService = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as never

  const service = new QppvNominationService(
    rls as never,
    auditService,
    documentsService,
    pdfService,
  )
  return { service, tables, auditLog, uploadDirect }
}

describe('QppvNominationService', () => {
  describe('setNomination()', () => {
    it('nominates a primary QPPV, generates the letter, and updates the company pointer', async () => {
      const { service, tables, uploadDirect } = buildHarness()
      const nomination = await service.setNomination(
        actor,
        { role: 'primary', qppvUserId: 'qppv-1' },
        {},
      )

      expect(nomination.role).toBe('primary')
      expect(nomination.nominationLetterDocumentId).toBe('doc-letter-1')
      expect(uploadDirect).toHaveBeenCalled()
      expect(tables.company.rows.get('company-1')!.primaryQppvUserId).toBe('qppv-1')
    })

    it('rejects a user who does not hold the QPPV role', async () => {
      const { service } = buildHarness()
      await expect(
        service.setNomination(actor, { role: 'primary', qppvUserId: 'non-qppv' }, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects nominating the same person as both primary and backup', async () => {
      const { service } = buildHarness()
      await service.setNomination(actor, { role: 'primary', qppvUserId: 'qppv-1' }, {})
      await expect(
        service.setNomination(actor, { role: 'backup', qppvUserId: 'qppv-1' }, {}),
      ).rejects.toThrow(BadRequestException)
    })

    it('supersedes the previous nomination for the same role', async () => {
      const { service, tables } = buildHarness()
      const first = await service.setNomination(
        actor,
        { role: 'primary', qppvUserId: 'qppv-1' },
        {},
      )
      const second = await service.setNomination(
        actor,
        { role: 'primary', qppvUserId: 'qppv-2' },
        {},
      )

      expect(tables.qppvNomination.rows.get(first.id)!.status).toBe('superseded')
      expect(second.status).toBe('active')
      expect(tables.company.rows.get('company-1')!.primaryQppvUserId).toBe('qppv-2')
    })

    it('allows independent primary and backup nominations', async () => {
      const { service, tables } = buildHarness()
      await service.setNomination(actor, { role: 'primary', qppvUserId: 'qppv-1' }, {})
      await service.setNomination(actor, { role: 'backup', qppvUserId: 'qppv-2' }, {})

      expect(tables.company.rows.get('company-1')!.primaryQppvUserId).toBe('qppv-1')
      expect(tables.company.rows.get('company-1')!.backupQppvUserId).toBe('qppv-2')
    })

    it('rejects an actor with no company', async () => {
      const { service } = buildHarness()
      await expect(
        service.setNomination(noCompanyActor, { role: 'primary', qppvUserId: 'qppv-1' }, {}),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('uploadRegulatorConfirmation()', () => {
    it('attaches a confirmation document to a real nomination', async () => {
      const { service, tables } = buildHarness()
      const nomination = await service.setNomination(
        actor,
        { role: 'primary', qppvUserId: 'qppv-1' },
        {},
      )
      tables.document.rows.set('conf-doc-1', { id: 'conf-doc-1', companyId: 'company-1' })

      const updated = await service.uploadRegulatorConfirmation(
        actor,
        nomination.id,
        { documentId: 'conf-doc-1' },
        {},
      )
      expect(updated.regulatorConfirmationDocumentId).toBe('conf-doc-1')
    })

    it('404s on an unknown nomination', async () => {
      const { service } = buildHarness()
      await expect(
        service.uploadRegulatorConfirmation(actor, 'nonexistent', { documentId: 'x' }, {}),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('getStatus()', () => {
    it('reports both current pointers and the full nomination history', async () => {
      const { service } = buildHarness()
      await service.setNomination(actor, { role: 'primary', qppvUserId: 'qppv-1' }, {})
      await service.setNomination(actor, { role: 'backup', qppvUserId: 'qppv-2' }, {})

      const status = await service.getStatus(actor)
      expect(status.primaryQppvUserId).toBe('qppv-1')
      expect(status.backupQppvUserId).toBe('qppv-2')
      expect(status.nominations).toHaveLength(2)
    })
  })
})
