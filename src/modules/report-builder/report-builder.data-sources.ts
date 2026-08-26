import { Prisma } from '@prisma/client'

export type ReportBuilderDataSourceKey = 'pv_case' | 'reg_dossier'

export interface ReportBuilderField {
  key: string
  label: string
  /** How to read this field off a fetched row — most fields are a plain column; a few (e.g. `reportType.name`) come off a joined relation, flattened at read time by `extractValue()`. */
  path: string[]
  /** Whether numeric comparison operators (`gt`/`lt`/`gte`/`lte`) make sense for this field — a plain string field only ever supports `eq`/`neq`/`contains`. */
  kind: 'string' | 'date' | 'number'
}

export interface ReportBuilderDataSource {
  key: ReportBuilderDataSourceKey
  label: string
  moduleKey: string
  fields: ReportBuilderField[]
  /** A real Prisma `findMany` scoped to `companyId`, with the minimal `select`/`include` needed to read every field in this catalog — the one and only query this data source ever runs, parameterized by `where`. */
  findMany: (
    tx: Prisma.TransactionClient,
    companyId: string,
    where: Prisma.CaseWhereInput | Prisma.RegDossierWhereInput,
  ) => Promise<Record<string, unknown>[]>
}

/**
 * Real-usage request, 11 Sep 2026 — "A proper report generator so
 * clients can build their own customised reports... pick the fields,
 * filter, group." This is the entire trust boundary of the self-service
 * builder: a client only ever picks from this fixed, pre-vetted catalog
 * — never a raw column name, join path, or SQL fragment — so
 * `ReportBuilderService` can safely turn a saved definition into a real
 * query without ever trusting client-supplied field/path strings
 * directly. Two data sources for this pass (PV cases, RegCloud dossiers)
 * — QualCloud has no schema yet (a real, acknowledged scope boundary,
 * confirmed with the user), and true cross-module joins (one report
 * spanning PV + Reg + Quality at once) are a materially larger feature
 * left for a future pass; each definition here picks exactly one source.
 */
export const REPORT_BUILDER_DATA_SOURCES: Record<
  ReportBuilderDataSourceKey,
  ReportBuilderDataSource
> = {
  pv_case: {
    key: 'pv_case',
    label: 'PV Cases',
    moduleKey: 'pv',
    fields: [
      {
        key: 'referenceNumber',
        label: 'Reference Number',
        path: ['referenceNumber'],
        kind: 'string',
      },
      { key: 'status', label: 'Workflow Status', path: ['status'], kind: 'string' },
      { key: 'channel', label: 'Channel', path: ['channel'], kind: 'string' },
      { key: 'seriousnessClass', label: 'Seriousness', path: ['seriousnessClass'], kind: 'string' },
      { key: 'reportTypeName', label: 'Report Type', path: ['reportType', 'name'], kind: 'string' },
      {
        key: 'countryOfOccurrenceName',
        label: 'Country of Occurrence',
        path: ['countryOfOccurrence', 'name'],
        kind: 'string',
      },
      { key: 'awarenessDate', label: 'Awareness Date', path: ['awarenessDate'], kind: 'date' },
      { key: 'receivedDate', label: 'Received Date', path: ['receivedDate'], kind: 'date' },
      { key: 'createdAt', label: 'Created', path: ['createdAt'], kind: 'date' },
      { key: 'closedAt', label: 'Closed & Archived', path: ['closedAt'], kind: 'date' },
    ],
    findMany: (tx, companyId, where) =>
      tx.case.findMany({
        where: { ...(where as Prisma.CaseWhereInput), companyId },
        select: {
          referenceNumber: true,
          status: true,
          channel: true,
          seriousnessClass: true,
          awarenessDate: true,
          receivedDate: true,
          createdAt: true,
          closedAt: true,
          reportType: { select: { name: true } },
          countryOfOccurrence: { select: { name: true } },
        },
      }),
  },
  reg_dossier: {
    key: 'reg_dossier',
    label: 'RegCloud Dossiers',
    moduleKey: 'regcloud',
    fields: [
      { key: 'productClass', label: 'Product Class', path: ['productClass'], kind: 'string' },
      { key: 'route', label: 'Route', path: ['route'], kind: 'string' },
      { key: 'status', label: 'Status', path: ['status'], kind: 'string' },
      { key: 'productBrandName', label: 'Product', path: ['product', 'brandName'], kind: 'string' },
      { key: 'authorityName', label: 'Authority', path: ['authority', 'name'], kind: 'string' },
      { key: 'createdAt', label: 'Created', path: ['createdAt'], kind: 'date' },
      { key: 'updatedAt', label: 'Last Updated', path: ['updatedAt'], kind: 'date' },
    ],
    findMany: (tx, companyId, where) =>
      tx.regDossier.findMany({
        where: { ...(where as Prisma.RegDossierWhereInput), companyId },
        select: {
          productClass: true,
          route: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          product: { select: { brandName: true } },
          authority: { select: { name: true } },
        },
      }),
  },
}

/** Reads a field's value off a fetched row, following a multi-segment `path` through a joined relation (e.g. `['reportType', 'name']`) — the read-side counterpart to each field's own catalog entry. */
export function extractValue(row: Record<string, unknown>, path: string[]): unknown {
  let value: unknown = row
  for (const segment of path) {
    if (value === null || value === undefined) return null
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

export function getDataSource(key: string): ReportBuilderDataSource | undefined {
  return REPORT_BUILDER_DATA_SOURCES[key as ReportBuilderDataSourceKey]
}

export function getField(
  source: ReportBuilderDataSource,
  key: string,
): ReportBuilderField | undefined {
  return source.fields.find((f) => f.key === key)
}
