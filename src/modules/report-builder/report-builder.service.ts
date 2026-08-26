import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { GeneratedReport, Prisma, ReportDefinition } from '@prisma/client'

import { newId } from '../../common/id'
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { DirectUploadFile, DocumentsService } from '../documents/documents.service'
import { BuildReportQueryDto } from './dto/build-report-query.dto'
import { FilterConditionDto, ReportBuilderFilterOperator } from './dto/filter-condition.dto'
import { SaveReportDefinitionDto } from './dto/save-report-definition.dto'
import {
  extractValue,
  getDataSource,
  getField,
  REPORT_BUILDER_DATA_SOURCES,
  ReportBuilderDataSource,
} from './report-builder.data-sources'

export interface RequestMeta {
  ip?: string
}

const PREVIEW_ROW_CAP = 200
const CUSTOM_REPORT_TYPE_KEY = 'custom_report'

export interface ReportBuilderResult {
  fields: { key: string; label: string }[]
  rows: Record<string, unknown>[] | null
  groups: { value: unknown; count: number }[] | null
  totalMatched: number
  truncated: boolean
}

function requireCompany(actor: AuthenticatedUser): string {
  if (!actor.companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'A report definition is tenant-scoped — a company is required',
    })
  }
  return actor.companyId
}

function validateAndResolveSource(dto: BuildReportQueryDto): ReportBuilderDataSource {
  const source = getDataSource(dto.dataSource)
  if (!source) {
    throw new BadRequestException({
      code: 'UNKNOWN_DATA_SOURCE',
      message: `Unknown data source "${dto.dataSource}"`,
    })
  }
  for (const key of dto.fields) {
    if (!getField(source, key)) {
      throw new BadRequestException({
        code: 'UNKNOWN_FIELD',
        message: `"${key}" is not a field of ${source.label}`,
      })
    }
  }
  for (const filter of dto.filters ?? []) {
    const field = getField(source, filter.field)
    if (!field) {
      throw new BadRequestException({
        code: 'UNKNOWN_FIELD',
        message: `"${filter.field}" is not a field of ${source.label}`,
      })
    }
    if (['gt', 'lt', 'gte', 'lte'].includes(filter.operator) && field.kind === 'string') {
      throw new BadRequestException({
        code: 'INVALID_OPERATOR',
        message: `"${filter.operator}" doesn't apply to the text field "${filter.field}"`,
      })
    }
    if (filter.operator === 'contains' && field.kind !== 'string') {
      throw new BadRequestException({
        code: 'INVALID_OPERATOR',
        message: `"contains" only applies to text fields, not "${filter.field}"`,
      })
    }
  }
  if (dto.groupByField && !getField(source, dto.groupByField)) {
    throw new BadRequestException({
      code: 'UNKNOWN_FIELD',
      message: `"${dto.groupByField}" is not a field of ${source.label}`,
    })
  }
  return source
}

function coerceValue(field: { kind: 'string' | 'date' | 'number' }, raw: string): unknown {
  if (field.kind === 'date') return new Date(raw)
  if (field.kind === 'number') return Number(raw)
  return raw
}

function operatorClause(
  operator: ReportBuilderFilterOperator,
  value: unknown,
): Record<string, unknown> {
  switch (operator) {
    case 'eq':
      return { equals: value }
    case 'neq':
      return { not: value }
    case 'gt':
      return { gt: value }
    case 'lt':
      return { lt: value }
    case 'gte':
      return { gte: value }
    case 'lte':
      return { lte: value }
    case 'contains':
      return { contains: value, mode: 'insensitive' }
  }
}

/** Nests an operator clause along a field's `path` — `['status']` → `{status: clause}`; `['reportType','name']` → `{reportType: {name: clause}}`. */
function nestClause(path: string[], clause: Record<string, unknown>): Record<string, unknown> {
  if (path.length === 1) return { [path[0]]: clause }
  return { [path[0]]: nestClause(path.slice(1), clause) }
}

function buildWhereClause(
  source: ReportBuilderDataSource,
  filters: FilterConditionDto[],
): Record<string, unknown> {
  const clauses = filters.map((filter) => {
    const field = getField(source, filter.field)!
    return nestClause(field.path, operatorClause(filter.operator, coerceValue(field, filter.value)))
  })
  return clauses.length === 0 ? {} : { AND: clauses }
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function toCsv(fields: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown) => {
    const s = stringifyValue(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = fields.map((f) => escape(f.label)).join(',')
  const body = rows.map((row) => fields.map((f) => escape(row[f.key])).join(',')).join('\n')
  return `${header}\n${body}\n`
}

/**
 * Real-usage request, 11 Sep 2026 — "A proper report generator so
 * clients can build their own customised reports, the way they can on
 * Salesforce: pick the fields, filter, group, save, schedule and
 * export." `preview()` and `run()` share the exact same validated-query
 * path (`validateAndResolveSource()` + `buildWhereClause()`) — a saved
 * definition is never trusted blindly at run time, it's re-validated
 * against the live field catalog every time, so a future catalog change
 * can't silently make an old saved definition do something unintended.
 */
@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  listDataSources() {
    return Object.values(REPORT_BUILDER_DATA_SOURCES).map((s) => ({
      key: s.key,
      label: s.label,
      fields: s.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind })),
    }))
  }

  async preview(actor: AuthenticatedUser, dto: BuildReportQueryDto): Promise<ReportBuilderResult> {
    const companyId = requireCompany(actor)
    const source = validateAndResolveSource(dto)
    const where = buildWhereClause(source, dto.filters ?? [])

    return this.rls.runAsCompany(companyId, async (tx) => {
      const allRows = await source.findMany(tx, companyId, where)
      return this.shapeResult(dto, source, allRows, PREVIEW_ROW_CAP)
    })
  }

  async save(
    actor: AuthenticatedUser,
    dto: SaveReportDefinitionDto,
    meta: RequestMeta,
  ): Promise<ReportDefinition> {
    const companyId = requireCompany(actor)
    validateAndResolveSource(dto)

    return this.rls.runAsCompany(companyId, async (tx) => {
      const created = await tx.reportDefinition.create({
        data: {
          id: newId(),
          companyId,
          name: dto.name,
          dataSource: dto.dataSource,
          fields: dto.fields,
          filters: (dto.filters ?? []) as unknown as Prisma.InputJsonValue,
          groupByField: dto.groupByField ?? null,
          scheduleCadenceDays: dto.scheduleCadenceDays ?? null,
          createdBy: actor.sub,
        },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'report_definition_saved',
        recordType: 'report_definition',
        recordId: created.id,
        newValue: { name: created.name, dataSource: created.dataSource },
        ip: meta.ip,
      })

      return created
    })
  }

  async list(actor: AuthenticatedUser): Promise<ReportDefinition[]> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) =>
      tx.reportDefinition.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
    )
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ReportDefinition> {
    const companyId = requireCompany(actor)
    return this.rls.runAsCompany(companyId, (tx) => this.findOrThrow(tx, companyId, id))
  }

  async delete(actor: AuthenticatedUser, id: string, meta: RequestMeta): Promise<void> {
    const companyId = requireCompany(actor)
    await this.rls.runAsCompany(companyId, async (tx) => {
      const existing = await this.findOrThrow(tx, companyId, id)
      await tx.reportDefinition.delete({ where: { id } })
      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor.sub,
        action: 'report_definition_deleted',
        recordType: 'report_definition',
        recordId: id,
        oldValue: { name: existing.name },
        ip: meta.ip,
      })
    })
  }

  /** Runs the full (uncapped) query, exports it as a CSV, uploads it, and records the run — the "export" (and, via the scheduler, "schedule") half of the feature. */
  async runExport(
    actor: AuthenticatedUser,
    id: string,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const companyId = requireCompany(actor)
    const definition = await this.rls.runAsCompany(companyId, (tx) =>
      this.findOrThrow(tx, companyId, id),
    )
    return this.runExportInternal(companyId, definition, actor, meta)
  }

  /** System-triggered re-run for a scheduled definition — called by `ReportBuilderScheduleProcessor`, mirroring `LineListingService.generateInternal()`'s actor-optional precedent. */
  async runExportSystem(
    companyId: string,
    definition: ReportDefinition,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    return this.runExportInternal(companyId, definition, null, meta)
  }

  private async runExportInternal(
    companyId: string,
    definition: ReportDefinition,
    actor: AuthenticatedUser | null,
    meta: RequestMeta,
  ): Promise<GeneratedReport> {
    const dto: BuildReportQueryDto = {
      dataSource: definition.dataSource as BuildReportQueryDto['dataSource'],
      fields: definition.fields as string[],
      filters: (definition.filters as unknown as FilterConditionDto[]) ?? [],
      groupByField: definition.groupByField ?? undefined,
    }
    const source = validateAndResolveSource(dto)
    const where = buildWhereClause(source, dto.filters ?? [])

    const { csv, title } = await this.rls.runAsCompany(companyId, async (tx) => {
      const allRows = await source.findMany(tx, companyId, where)
      const shaped = this.shapeResult(dto, source, allRows, Infinity)
      const exportFields = dto.fields.map((key) => ({ key, label: getField(source, key)!.label }))
      const exportRows = shaped.groups
        ? shaped.groups.map((g) => ({ [dto.groupByField!]: g.value, count: g.count }))
        : shaped.rows!
      const exportFieldsWithGroupCount = shaped.groups
        ? [
            ...exportFields.filter((f) => f.key === dto.groupByField),
            { key: 'count', label: 'Count' },
          ]
        : exportFields
      return {
        csv: toCsv(exportFieldsWithGroupCount, exportRows),
        title: `${definition.name} — ${new Date().toISOString().slice(0, 10)}`,
      }
    })

    const reportId = newId()
    const file: DirectUploadFile = {
      buffer: Buffer.from(csv, 'utf-8'),
      originalname: `${definition.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`,
      mimetype: 'text/csv',
    }
    if (actor) {
      await this.documentsService.uploadDirect(
        actor,
        'generated_report',
        reportId,
        file,
        { title },
        meta,
      )
    } else {
      await this.documentsService.uploadDirectSystem(
        companyId,
        'generated_report',
        reportId,
        file,
        { title },
        meta,
      )
    }

    return this.rls.runAsCompany(companyId, async (tx) => {
      const report = await tx.generatedReport.create({
        data: {
          id: reportId,
          companyId,
          moduleKey: source.moduleKey,
          reportTypeKey: CUSTOM_REPORT_TYPE_KEY,
          title,
          recordType: 'report_definition',
          recordId: definition.id,
          status: 'final',
          generatedBy: actor?.sub ?? null,
        },
      })

      await tx.reportDefinition.update({
        where: { id: definition.id },
        data: { lastRunAt: new Date() },
      })

      await this.auditService.log(tx, {
        companyId,
        actorUserId: actor?.sub ?? null,
        action: 'report_definition_exported',
        recordType: 'report_definition',
        recordId: definition.id,
        newValue: { generatedReportId: report.id },
        ip: meta.ip,
      })

      return report
    })
  }

  /** Auto-exports every company's own scheduled definitions that are due. Called by `ReportBuilderScheduleProcessor`. */
  async scanAndAutoRun(): Promise<{ generated: number }> {
    let generated = 0
    const due = await this.rls.runWithSystemAccess((tx) =>
      tx.reportDefinition.findMany({ where: { scheduleCadenceDays: { not: null } } }),
    )

    for (const definition of due) {
      const cadenceMs = definition.scheduleCadenceDays! * 24 * 60 * 60 * 1000
      const isDue =
        !definition.lastRunAt || Date.now() - definition.lastRunAt.getTime() >= cadenceMs
      if (!isDue) continue

      try {
        await this.runExportSystem(definition.companyId, definition, {})
        generated += 1
      } catch {
        // Best-effort — one company's misconfigured/stale definition (e.g. its data source no longer resolves) must not block every other company's scheduled export.
      }
    }

    return { generated }
  }

  private shapeResult(
    dto: BuildReportQueryDto,
    source: ReportBuilderDataSource,
    allRows: Record<string, unknown>[],
    cap: number,
  ): ReportBuilderResult {
    const fields = dto.fields.map((key) => ({ key, label: getField(source, key)!.label }))
    const shapedRows = allRows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const key of dto.fields) out[key] = extractValue(row, getField(source, key)!.path)
      return out
    })

    if (dto.groupByField) {
      const counts = new Map<string, number>()
      const displayValue = new Map<string, unknown>()
      for (const row of allRows) {
        const raw = extractValue(row, getField(source, dto.groupByField)!.path)
        const key = stringifyValue(raw) || '(none)'
        counts.set(key, (counts.get(key) ?? 0) + 1)
        displayValue.set(key, raw instanceof Date ? key : (raw ?? '(none)'))
      }
      const groups = [...counts.entries()]
        .map(([key, count]) => ({ value: displayValue.get(key), count }))
        .sort((a, b) => b.count - a.count)
      return { fields, rows: null, groups, totalMatched: allRows.length, truncated: false }
    }

    return {
      fields,
      rows: shapedRows.slice(0, cap),
      groups: null,
      totalMatched: allRows.length,
      truncated: allRows.length > cap,
    }
  }

  private async findOrThrow(
    tx: Prisma.TransactionClient,
    companyId: string,
    id: string,
  ): Promise<ReportDefinition> {
    const definition = await tx.reportDefinition.findFirst({ where: { id, companyId } })
    if (!definition)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Report definition not found' })
    return definition
  }
}
