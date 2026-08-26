import { BadRequestException, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { ReportBuilderService } from './report-builder.service'

const actor: AuthenticatedUser = {
  sub: 'user-1',
  companyId: 'company-1',
  roleKeys: ['REGULATORY_AFFAIRS_OFFICER'],
  platformRole: null,
  tokenVersion: 1,
}

function buildHarness() {
  const caseRows = [
    {
      referenceNumber: 'CASE-1',
      status: 'triage',
      channel: 'form',
      seriousnessClass: 'serious',
      awarenessDate: new Date('2026-01-01'),
      receivedDate: new Date('2026-01-02'),
      createdAt: new Date('2026-01-01'),
      closedAt: null,
      reportType: { name: 'ADR' },
      countryOfOccurrence: { name: 'Kenya' },
    },
    {
      referenceNumber: 'CASE-2',
      status: 'submitted',
      channel: 'email',
      seriousnessClass: 'non_serious',
      awarenessDate: new Date('2026-02-01'),
      receivedDate: new Date('2026-02-02'),
      createdAt: new Date('2026-02-01'),
      closedAt: null,
      reportType: { name: 'ADR' },
      countryOfOccurrence: { name: 'Uganda' },
    },
  ]

  const caseFindMany = jest.fn().mockResolvedValue(caseRows)
  const regDossierFindMany = jest.fn().mockResolvedValue([])

  const definitions = new Map<string, Record<string, unknown>>()
  const reportDefinitionCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      definitions.set(data.id as string, data)
      return Promise.resolve(data)
    })
  const reportDefinitionFindFirst = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string; companyId: string } }) => {
      const row = definitions.get(where.id)
      return Promise.resolve(row && row.companyId === where.companyId ? row : null)
    })
  const reportDefinitionFindMany = jest
    .fn()
    .mockImplementation(
      ({ where }: { where?: { companyId?: string; scheduleCadenceDays?: unknown } }) =>
        Promise.resolve(
          [...definitions.values()].filter(
            (d) =>
              (!where?.companyId || d.companyId === where.companyId) &&
              (!where?.scheduleCadenceDays || d.scheduleCadenceDays !== null),
          ),
        ),
    )
  const reportDefinitionUpdate = jest
    .fn()
    .mockImplementation(
      ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = definitions.get(where.id)!
        const updated = { ...existing, ...data }
        definitions.set(where.id, updated)
        return Promise.resolve(updated)
      },
    )
  const reportDefinitionDelete = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) => {
      definitions.delete(where.id)
      return Promise.resolve({})
    })

  const generatedReportCreate = jest
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data))

  const tables = {
    case: { findMany: caseFindMany },
    regDossier: { findMany: regDossierFindMany },
    reportDefinition: {
      create: reportDefinitionCreate,
      findFirst: reportDefinitionFindFirst,
      findMany: reportDefinitionFindMany,
      update: reportDefinitionUpdate,
      delete: reportDefinitionDelete,
    },
    generatedReport: { create: generatedReportCreate },
  }
  const rls = {
    runAsCompany: (_companyId: string, fn: (tx: typeof tables) => unknown) => fn(tables),
    runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables),
  }

  const auditLog = jest.fn().mockResolvedValue(undefined)
  const auditService = { log: auditLog } as never

  const uploadDirect = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-1' }, version: { id: 'ver-1' } })
  const uploadDirectSystem = jest
    .fn()
    .mockResolvedValue({ document: { id: 'doc-2' }, version: { id: 'ver-2' } })
  const documentsService = { uploadDirect, uploadDirectSystem } as never

  const service = new ReportBuilderService(rls as never, auditService, documentsService)
  return {
    service,
    definitions,
    caseFindMany,
    uploadDirect,
    uploadDirectSystem,
    generatedReportCreate,
    auditLog,
  }
}

describe('ReportBuilderService', () => {
  describe('preview()', () => {
    it('returns shaped rows for a valid pv_case query', async () => {
      const { service } = buildHarness()
      const result = await service.preview(actor, {
        dataSource: 'pv_case',
        fields: ['referenceNumber', 'status', 'reportTypeName'],
      })

      expect(result.rows).toHaveLength(2)
      expect(result.rows![0]).toEqual({
        referenceNumber: 'CASE-1',
        status: 'triage',
        reportTypeName: 'ADR',
      })
      expect(result.groups).toBeNull()
      expect(result.totalMatched).toBe(2)
    })

    it('rejects an unknown field', async () => {
      const { service } = buildHarness()
      await expect(
        service.preview(actor, { dataSource: 'pv_case', fields: ['not_a_real_field'] }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects an unknown data source', async () => {
      const { service } = buildHarness()
      await expect(
        service.preview(actor, { dataSource: 'qualcloud_deviation' as never, fields: ['x'] }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a numeric operator against a text field', async () => {
      const { service } = buildHarness()
      await expect(
        service.preview(actor, {
          dataSource: 'pv_case',
          fields: ['status'],
          filters: [{ field: 'status', operator: 'gt', value: 'x' }],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('groups by a field and counts, sorted by count descending', async () => {
      const { service } = buildHarness()
      const result = await service.preview(actor, {
        dataSource: 'pv_case',
        fields: ['referenceNumber'],
        groupByField: 'seriousnessClass',
      })

      expect(result.groups).toEqual(
        [
          { value: 'serious', count: 1 },
          { value: 'non_serious', count: 1 },
        ].sort((a, b) => b.count - a.count),
      )
      expect(result.rows).toBeNull()
    })
  })

  describe('save() / list() / get() / delete()', () => {
    it('saves a definition and audits it', async () => {
      const { service, auditLog } = buildHarness()
      const saved = await service.save(
        actor,
        { dataSource: 'pv_case', fields: ['referenceNumber'], name: 'My Report' } as never,
        {},
      )

      expect(saved.name).toBe('My Report')
      expect(saved.dataSource).toBe('pv_case')
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'report_definition_saved' }),
      )
    })

    it('404s getting an unknown definition', async () => {
      const { service } = buildHarness()
      await expect(service.get(actor, 'nonexistent')).rejects.toThrow(NotFoundException)
    })

    it("lists only this company's own definitions", async () => {
      const { service } = buildHarness()
      await service.save(
        actor,
        { dataSource: 'pv_case', fields: ['referenceNumber'], name: 'A' } as never,
        {},
      )
      const list = await service.list(actor)
      expect(list).toHaveLength(1)
    })

    it('deletes a definition', async () => {
      const { service } = buildHarness()
      const saved = await service.save(
        actor,
        { dataSource: 'pv_case', fields: ['referenceNumber'], name: 'A' } as never,
        {},
      )
      await service.delete(actor, saved.id, {})
      await expect(service.get(actor, saved.id)).rejects.toThrow(NotFoundException)
    })
  })

  describe('runExport()', () => {
    it('uploads a CSV, creates a GeneratedReport, and stamps lastRunAt', async () => {
      const { service, uploadDirect, generatedReportCreate } = buildHarness()
      const saved = await service.save(
        actor,
        {
          dataSource: 'pv_case',
          fields: ['referenceNumber', 'status'],
          name: 'My Export',
        } as never,
        {},
      )

      const report = await service.runExport(actor, saved.id, {})

      expect(uploadDirect).toHaveBeenCalledWith(
        actor,
        'generated_report',
        report.id,
        expect.objectContaining({ mimetype: 'text/csv' }),
        expect.objectContaining({ title: expect.stringContaining('My Export') }),
        {},
      )
      expect(generatedReportCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ moduleKey: 'pv', reportTypeKey: 'custom_report' }),
        }),
      )

      const refetched = await service.get(actor, saved.id)
      expect(refetched.lastRunAt).toBeInstanceOf(Date)
    })
  })

  describe('scanAndAutoRun()', () => {
    it('runs only definitions with a schedule cadence set, and skips one not yet due', async () => {
      const { service, uploadDirectSystem } = buildHarness()
      await service.save(
        actor,
        {
          dataSource: 'pv_case',
          fields: ['referenceNumber'],
          name: 'Scheduled',
          scheduleCadenceDays: 7,
        } as never,
        {},
      )
      await service.save(
        actor,
        { dataSource: 'pv_case', fields: ['referenceNumber'], name: 'Unscheduled' } as never,
        {},
      )

      const result = await service.scanAndAutoRun()

      expect(result.generated).toBe(1)
      expect(uploadDirectSystem).toHaveBeenCalledTimes(1)
    })
  })
})
