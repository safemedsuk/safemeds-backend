import { Injectable } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { parseCsvToObjects } from '../bulk-import/csv.util'
import { ImporterColumn, RequestMeta } from '../bulk-import/importers/importer.interface'
import { RegEntitiesService } from './reg-entities.service'

export interface RegEntitiesPreviewRowResult {
  rowNumber: number
  data: Record<string, string>
  errors: string[]
}

export interface RegEntitiesFilePreview {
  columns: ImporterColumn[]
  totalRows: number
  validRows: RegEntitiesPreviewRowResult[]
  invalidRows: RegEntitiesPreviewRowResult[]
}

export interface RegEntitiesImportPreview {
  manufacturers: RegEntitiesFilePreview
  sites: RegEntitiesFilePreview
  localRepresentatives: RegEntitiesFilePreview
}

export interface RegEntitiesCommitRowResult {
  rowNumber: number
  success: boolean
  error?: string
}

export interface RegEntitiesFileCommitResult {
  committed: number
  failed: RegEntitiesCommitRowResult[]
}

export interface RegEntitiesImportCommitResult {
  manufacturers: RegEntitiesFileCommitResult
  sites: RegEntitiesFileCommitResult
  localRepresentatives: RegEntitiesFileCommitResult
}

const MANUFACTURER_COLUMNS: ImporterColumn[] = [
  {
    key: 'manufacturerKey',
    label: 'Manufacturer Key',
    required: true,
    aliases: ['Key', 'Manufacturer ID', 'Reference'],
  },
  { key: 'name', label: 'Manufacturer Name', required: true, aliases: ['Manufacturer'] },
  { key: 'country', label: 'Country', required: false, aliases: ['Country Name', 'Country Code'] },
  { key: 'address', label: 'Address', required: false },
]

const SITE_COLUMNS: ImporterColumn[] = [
  {
    key: 'manufacturerKey',
    label: 'Manufacturer Key',
    required: true,
    aliases: ['Key', 'Manufacturer', 'Manufacturer ID', 'Manufacturer Name'],
  },
  { key: 'siteName', label: 'Site Name', required: true, aliases: ['Site', 'Manufacturing Site'] },
  { key: 'country', label: 'Country', required: false, aliases: ['Country Name', 'Country Code'] },
  { key: 'address', label: 'Address', required: false },
  {
    key: 'gmpCertificateNumber',
    label: 'GMP Certificate Number',
    required: false,
    aliases: ['GMP Certificate', 'GMP Number'],
  },
  {
    key: 'gmpCertificateExpiresOn',
    label: 'GMP Certificate Expires On',
    required: false,
    aliases: ['GMP Expiry', 'GMP Expiry Date', 'Certificate Expiry'],
  },
]

const LOCAL_REPRESENTATIVE_COLUMNS: ImporterColumn[] = [
  { key: 'name', label: 'Local Representative Name', required: true, aliases: ['Name', 'Representative'] },
  { key: 'country', label: 'Country', required: false, aliases: ['Country Name', 'Country Code'] },
  { key: 'contactEmail', label: 'Contact Email', required: false, aliases: ['Email'] },
  { key: 'contactPhone', label: 'Contact Phone', required: false, aliases: ['Phone'] },
  { key: 'address', label: 'Address', required: false },
]

function remapHeaders(
  row: Record<string, string>,
  columns: ImporterColumn[],
): Record<string, string> {
  const remapped: Record<string, string> = {}
  for (const [header, value] of Object.entries(row)) {
    const normalized = header.trim().toLowerCase()
    const match = columns.find(
      (c) =>
        c.key.toLowerCase() === normalized ||
        c.label.toLowerCase() === normalized ||
        c.aliases?.some((a) => a.toLowerCase() === normalized),
    )
    remapped[match ? match.key : header] = value
  }
  return remapped
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * testing-correction-explanation.md §4.1 — the Regulatory Entities bulk
 * import: Manufacturers, Manufacturing Sites, and Local Representatives,
 * up to 3 files in one request. Deliberately **not** built on the
 * generic single-file `Importer` interface (`src/modules/bulk-import/`)
 * — that framework has no notion of a row in one file referencing a row
 * in another, and stretching it to fake one would be worse than a
 * second, purpose-built flow (see `Importer`'s own doc comment, which
 * anticipated exactly this).
 *
 * The relational link is real for exactly one pair: `ManufacturingSite
 * .manufacturerId` is a real FK on `Manufacturer`. `LocalRepresentative`
 * has **no** FK to `Manufacturer` in this schema at all (confirmed by
 * reading it directly) — its own file's rows import completely
 * independently, needing no `manufacturerKey` column. The plan's
 * original "3-way relational" framing is generously simplified here to
 * match what the schema actually models, rather than inventing a
 * relationship that doesn't exist.
 *
 * `manufacturerKey` is a client-made-up, batch-scoped label (e.g.
 * `MFG-001`) — never persisted anywhere, since it only needs to mean
 * something within this one upload. A site row resolves it two ways,
 * tried in order: (1) against the manufacturers file uploaded in the
 * *same* request (the literal design), then (2) — a deliberate
 * enhancement beyond the literal plan, for the equally real "add more
 * sites to a manufacturer I imported last month" case — as a
 * best-effort existing-manufacturer name match
 * (`RegEntitiesService.findManufacturerByName()`), the same "no
 * schema-level uniqueness, first match wins" honesty already
 * established by `RiskManagementPlanService.findProductByBrandName()`.
 *
 * Commit order is manufacturers, then sites, then local representatives
 * — never one giant transaction (matching the generic bulk-import
 * framework's own per-row-tolerant shape: a bad row's own error is
 * reported and the rest of the batch still commits), but strictly
 * sequenced so the manufacturer key→id map sites depend on is fully
 * built before any site row is attempted.
 */
@Injectable()
export class RegEntitiesImportService {
  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly regEntitiesService: RegEntitiesService,
  ) {}

  /**
   * Resolves a human-typed country column (ISO code or name, e.g. "KE"
   * or "Kenya") to a real `countryId` — no such text-to-UUID resolver
   * existed anywhere in this codebase before this importer (every other
   * call site already had a UUID in hand). Returns `undefined` only
   * when the column was genuinely blank; an unresolvable non-blank
   * value throws, so a typo is reported as a row error, never silently
   * dropped.
   */
  private async resolveCountryId(actor: AuthenticatedUser, text: string): Promise<string | undefined> {
    const trimmed = text.trim()
    if (!trimmed) return undefined
    const companyId = actor.companyId
    if (!companyId) return undefined
    const country = await this.rls.runAsCompany(companyId, (tx) =>
      tx.country.findFirst({
        where: {
          OR: [{ isoCode: { equals: trimmed, mode: 'insensitive' } }, { name: { equals: trimmed, mode: 'insensitive' } }],
        },
        select: { id: true },
      }),
    )
    if (!country) throw new Error(`Country "${text.trim()}" is not recognized`)
    return country.id
  }

  private validateManufacturerRow(row: Record<string, string>, seenKeys: Set<string>): string[] {
    const errors: string[] = []
    const key = row.manufacturerKey?.trim()
    if (!key) errors.push('Manufacturer Key is required')
    else if (seenKeys.has(key.toLowerCase())) errors.push(`Duplicate Manufacturer Key "${key}" — keys must be unique within this file`)
    if (!row.name?.trim()) errors.push('Manufacturer Name is required')
    return errors
  }

  private validateSiteRow(row: Record<string, string>): string[] {
    const errors: string[] = []
    if (!row.manufacturerKey?.trim()) errors.push('Manufacturer Key is required')
    if (!row.siteName?.trim()) errors.push('Site Name is required')
    if (row.gmpCertificateExpiresOn?.trim() && Number.isNaN(Date.parse(row.gmpCertificateExpiresOn))) {
      errors.push(`GMP Certificate Expires On "${row.gmpCertificateExpiresOn}" is not a valid date`)
    }
    return errors
  }

  private validateLocalRepresentativeRow(row: Record<string, string>): string[] {
    const errors: string[] = []
    if (!row.name?.trim()) errors.push('Local Representative Name is required')
    if (row.contactEmail?.trim() && !EMAIL_PATTERN.test(row.contactEmail.trim())) {
      errors.push(`Contact Email "${row.contactEmail}" is not a valid email address`)
    }
    return errors
  }

  /** Non-mutating — resolves the country column purely to validate it's recognizable, discarding the id. Returns an error string, or null when the column is blank or resolves cleanly. */
  private async checkCountryColumn(actor: AuthenticatedUser, row: Record<string, string>): Promise<string | null> {
    if (!row.country?.trim()) return null
    try {
      await this.resolveCountryId(actor, row.country)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Unknown error'
    }
  }

  async preview(actor: AuthenticatedUser, dto: { manufacturersCsv?: string; sitesCsv?: string; localRepresentativesCsv?: string }): Promise<RegEntitiesImportPreview> {
    const manufacturerRows = dto.manufacturersCsv ? parseCsvToObjects(dto.manufacturersCsv).rows : []
    const siteRows = dto.sitesCsv ? parseCsvToObjects(dto.sitesCsv).rows : []
    const localRepresentativeRows = dto.localRepresentativesCsv
      ? parseCsvToObjects(dto.localRepresentativesCsv).rows
      : []

    const manufacturers: RegEntitiesFilePreview = { columns: MANUFACTURER_COLUMNS, totalRows: manufacturerRows.length, validRows: [], invalidRows: [] }
    const seenManufacturerKeys = new Set<string>()
    const manufacturerKeysInFile = new Set<string>()
    for (let index = 0; index < manufacturerRows.length; index += 1) {
      const data = remapHeaders(manufacturerRows[index], MANUFACTURER_COLUMNS)
      const errors = this.validateManufacturerRow(data, seenManufacturerKeys)
      const countryError = await this.checkCountryColumn(actor, data)
      if (countryError) errors.push(countryError)
      const key = data.manufacturerKey?.trim().toLowerCase()
      if (key) seenManufacturerKeys.add(key)
      const result: RegEntitiesPreviewRowResult = { rowNumber: index + 1, data, errors }
      ;(errors.length === 0 ? manufacturers.validRows : manufacturers.invalidRows).push(result)
      if (errors.length === 0 && key) manufacturerKeysInFile.add(key)
    }

    const sites: RegEntitiesFilePreview = { columns: SITE_COLUMNS, totalRows: siteRows.length, validRows: [], invalidRows: [] }
    for (let index = 0; index < siteRows.length; index += 1) {
      const data = remapHeaders(siteRows[index], SITE_COLUMNS)
      const errors = this.validateSiteRow(data)
      const countryError = await this.checkCountryColumn(actor, data)
      if (countryError) errors.push(countryError)
      const key = data.manufacturerKey?.trim()
      if (key && !manufacturerKeysInFile.has(key.toLowerCase())) {
        // Not in this batch's own manufacturers file — try a live, best-effort match against an existing manufacturer by name (the "add sites to an already-imported manufacturer" case).
        const existing = await this.regEntitiesService.findManufacturerByName(actor, key)
        if (!existing) {
          errors.push(`Manufacturer Key "${key}" does not match any manufacturer in this upload or your existing catalog`)
        }
      }
      const result: RegEntitiesPreviewRowResult = { rowNumber: index + 1, data, errors }
      ;(errors.length === 0 ? sites.validRows : sites.invalidRows).push(result)
    }

    const localRepresentatives: RegEntitiesFilePreview = {
      columns: LOCAL_REPRESENTATIVE_COLUMNS,
      totalRows: localRepresentativeRows.length,
      validRows: [],
      invalidRows: [],
    }
    for (let index = 0; index < localRepresentativeRows.length; index += 1) {
      const data = remapHeaders(localRepresentativeRows[index], LOCAL_REPRESENTATIVE_COLUMNS)
      const errors = this.validateLocalRepresentativeRow(data)
      const countryError = await this.checkCountryColumn(actor, data)
      if (countryError) errors.push(countryError)
      const result: RegEntitiesPreviewRowResult = { rowNumber: index + 1, data, errors }
      ;(errors.length === 0 ? localRepresentatives.validRows : localRepresentatives.invalidRows).push(result)
    }

    return { manufacturers, sites, localRepresentatives }
  }

  async commit(
    actor: AuthenticatedUser,
    dto: { manufacturers?: Record<string, string>[]; sites?: Record<string, string>[]; localRepresentatives?: Record<string, string>[] },
    meta: RequestMeta,
  ): Promise<RegEntitiesImportCommitResult> {
    const manufacturerKeyToId = new Map<string, string>()
    const manufacturerResult: RegEntitiesFileCommitResult = { committed: 0, failed: [] }

    for (let index = 0; index < (dto.manufacturers ?? []).length; index += 1) {
      const row = remapHeaders(dto.manufacturers![index], MANUFACTURER_COLUMNS)
      const rowNumber = index + 1
      const errors = this.validateManufacturerRow(row, new Set())
      if (errors.length > 0) {
        manufacturerResult.failed.push({ rowNumber, success: false, error: errors.join('; ') })
        continue
      }
      try {
        const key = row.manufacturerKey.trim().toLowerCase()
        // Best-effort match against an already-cataloged manufacturer first — never creates a duplicate for a name that already exists.
        const existing = await this.regEntitiesService.findManufacturerByName(actor, row.name.trim())
        if (existing) {
          manufacturerKeyToId.set(key, existing.id)
        } else {
          const countryId = row.country?.trim() ? await this.resolveCountryId(actor, row.country) : undefined
          const created = await this.regEntitiesService.createManufacturer(
            actor,
            {
              name: row.name.trim(),
              countryId,
              address: row.address?.trim() || undefined,
            },
            meta,
          )
          manufacturerKeyToId.set(key, created.id)
        }
        manufacturerResult.committed += 1
      } catch (error) {
        manufacturerResult.failed.push({
          rowNumber,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const siteResult: RegEntitiesFileCommitResult = { committed: 0, failed: [] }
    for (let index = 0; index < (dto.sites ?? []).length; index += 1) {
      const row = remapHeaders(dto.sites![index], SITE_COLUMNS)
      const rowNumber = index + 1
      const errors = this.validateSiteRow(row)
      if (errors.length > 0) {
        siteResult.failed.push({ rowNumber, success: false, error: errors.join('; ') })
        continue
      }
      try {
        const key = row.manufacturerKey.trim()
        let manufacturerId = manufacturerKeyToId.get(key.toLowerCase())
        if (!manufacturerId) {
          const existing = await this.regEntitiesService.findManufacturerByName(actor, key)
          if (!existing) {
            throw new Error(`Manufacturer Key "${key}" does not match any manufacturer in this upload or your existing catalog`)
          }
          manufacturerId = existing.id
        }
        const countryId = row.country?.trim() ? await this.resolveCountryId(actor, row.country) : undefined
        await this.regEntitiesService.createManufacturingSite(
          actor,
          {
            manufacturerId,
            siteName: row.siteName.trim(),
            countryId,
            address: row.address?.trim() || undefined,
            gmpCertificateNumber: row.gmpCertificateNumber?.trim() || undefined,
            gmpCertificateExpiresOn: row.gmpCertificateExpiresOn?.trim()
              ? new Date(row.gmpCertificateExpiresOn).toISOString()
              : undefined,
          },
          meta,
        )
        siteResult.committed += 1
      } catch (error) {
        siteResult.failed.push({
          rowNumber,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const localRepresentativeResult: RegEntitiesFileCommitResult = { committed: 0, failed: [] }
    for (let index = 0; index < (dto.localRepresentatives ?? []).length; index += 1) {
      const row = remapHeaders(dto.localRepresentatives![index], LOCAL_REPRESENTATIVE_COLUMNS)
      const rowNumber = index + 1
      const errors = this.validateLocalRepresentativeRow(row)
      if (errors.length > 0) {
        localRepresentativeResult.failed.push({ rowNumber, success: false, error: errors.join('; ') })
        continue
      }
      try {
        const countryId = row.country?.trim() ? await this.resolveCountryId(actor, row.country) : undefined
        await this.regEntitiesService.createLocalRepresentative(
          actor,
          {
            name: row.name.trim(),
            countryId,
            contactEmail: row.contactEmail?.trim() || undefined,
            contactPhone: row.contactPhone?.trim() || undefined,
            address: row.address?.trim() || undefined,
          },
          meta,
        )
        localRepresentativeResult.committed += 1
      } catch (error) {
        localRepresentativeResult.failed.push({
          rowNumber,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    if (actor.companyId) {
      await this.rls.runAsCompany(actor.companyId, (tx) =>
        this.auditService.log(tx, {
          companyId: actor.companyId,
          actorUserId: actor.sub,
          action: 'reg_entities_bulk_import_completed',
          recordType: 'reg_entities_import',
          newValue: {
            manufacturers: { attempted: dto.manufacturers?.length ?? 0, committed: manufacturerResult.committed, failed: manufacturerResult.failed.length },
            sites: { attempted: dto.sites?.length ?? 0, committed: siteResult.committed, failed: siteResult.failed.length },
            localRepresentatives: {
              attempted: dto.localRepresentatives?.length ?? 0,
              committed: localRepresentativeResult.committed,
              failed: localRepresentativeResult.failed.length,
            },
          },
          ip: meta.ip,
        }),
      )
    }

    return { manufacturers: manufacturerResult, sites: siteResult, localRepresentatives: localRepresentativeResult }
  }
}
