import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'

import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface'
import { RlsService } from '../../common/rls/rls.service'
import { AuditService } from '../audit/audit.service'
import { RolesService } from '../roles/roles.service'
import { parseCsvToObjects } from './csv.util'
import { ClinicalTrialSubjectImporter } from './importers/clinical-trial-subject.importer'
import { Importer, ImporterColumn, RequestMeta } from './importers/importer.interface'
import { ProductImporter } from './importers/product.importer'
import { RmpImporter } from './importers/rmp.importer'
import { UserInviteImporter } from './importers/user-invite.importer'

export interface PreviewRowResult {
  rowNumber: number
  data: Record<string, string>
  errors: string[]
}

export interface PreviewResult {
  importType: string
  columns: ImporterColumn[]
  totalRows: number
  validRows: PreviewRowResult[]
  invalidRows: PreviewRowResult[]
}

export interface CommitRowResult {
  rowNumber: number
  success: boolean
  error?: string
}

export interface CommitResult {
  importType: string
  committed: number
  failed: CommitRowResult[]
}

/**
 * VigiCloud Stage 0.6 — the generic bulk-import framework. `IMPORTERS` is
 * the registry every new importer joins (Stage 2's `product`, Stage 14's
 * `clinical_trial_patient`, ...) — adding one is a one-line addition here
 * plus the importer class itself, nothing else in this file changes.
 */
@Injectable()
export class BulkImportService {
  private readonly importers: Map<string, Importer>

  constructor(
    private readonly rls: RlsService,
    private readonly auditService: AuditService,
    private readonly rolesService: RolesService,
    userInviteImporter: UserInviteImporter,
    productImporter: ProductImporter,
    clinicalTrialSubjectImporter: ClinicalTrialSubjectImporter,
    rmpImporter: RmpImporter,
  ) {
    this.importers = new Map<string, Importer>([
      [userInviteImporter.importType, userInviteImporter],
      [productImporter.importType, productImporter],
      [clinicalTrialSubjectImporter.importType, clinicalTrialSubjectImporter],
      [rmpImporter.importType, rmpImporter],
    ])
  }

  getImporter(importType: string): Importer {
    const importer = this.importers.get(importType)
    if (!importer) {
      throw new NotFoundException({
        code: 'UNKNOWN_IMPORT_TYPE',
        message: `No importer registered for "${importType}"`,
      })
    }
    return importer
  }

  /** Each importer declares its own required permission (see `Importer.requiredPermission`'s doc comment) — checked here, at the one place both `preview()` and `commit()` already resolve the importer for `:importType`, rather than a static per-controller-class `@RequirePermissions()` that can't vary by route param. */
  private async assertPermission(actor: AuthenticatedUser, importer: Importer): Promise<void> {
    const granted = await this.rolesService.getPermissionsForUser(actor)
    if (!granted.has(importer.requiredPermission)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to perform this action',
        details: { missing: [importer.requiredPermission] },
      })
    }
  }

  /**
   * Renames whatever header a real spreadsheet actually used (e.g.
   * "Email Address", "Roles") onto the importer's canonical column `key`
   * (e.g. `email`, `roleKeys`), matched case-insensitively against each
   * column's `key`/`label`/`aliases` — so a business user's own column
   * naming doesn't have to match the technical field name exactly.
   * Columns that don't match anything pass through unchanged (extra/
   * unrecognized columns are ignored downstream, not fatal).
   */
  private remapHeaders(
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

  async preview(
    actor: AuthenticatedUser,
    importType: string,
    csvText: string,
  ): Promise<PreviewResult> {
    const importer = this.getImporter(importType)
    await this.assertPermission(actor, importer)
    const { rows } = parseCsvToObjects(csvText)

    const validRows: PreviewRowResult[] = []
    const invalidRows: PreviewRowResult[] = []

    rows.forEach((rawData, index) => {
      const data = this.remapHeaders(rawData, importer.columns)
      const errors = importer.validateRow(data)
      const result: PreviewRowResult = { rowNumber: index + 1, data, errors }
      ;(errors.length === 0 ? validRows : invalidRows).push(result)
    })

    return { importType, columns: importer.columns, totalRows: rows.length, validRows, invalidRows }
  }

  async commit(
    actor: AuthenticatedUser,
    importType: string,
    rows: Record<string, string>[],
    meta: RequestMeta,
  ): Promise<CommitResult> {
    const importer = this.getImporter(importType)
    await this.assertPermission(actor, importer)
    const failed: CommitRowResult[] = []
    let committed = 0

    for (let index = 0; index < rows.length; index += 1) {
      const row = this.remapHeaders(rows[index], importer.columns)
      const rowNumber = index + 1

      // Re-validated server-side even though the client normally sends
      // back exactly what `preview()` already approved — a client-supplied
      // JSON body is never trusted blindly.
      const validationErrors = importer.validateRow(row)
      if (validationErrors.length > 0) {
        failed.push({ rowNumber, success: false, error: validationErrors.join('; ') })
        continue
      }

      try {
        await importer.commitRow(actor, row, meta)
        committed += 1
      } catch (error) {
        failed.push({
          rowNumber,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // A summary entry, not a per-change audit write in the change's own
    // transaction (unlike every other service in this codebase) — each
    // row already got its own atomic audit entry inside its own
    // `commitRow()` call (e.g. `invitation_created`); this one line
    // records the batch outcome after every row has been attempted, which
    // by definition spans many separate transactions.
    if (actor.companyId) {
      await this.rls.runAsCompany(actor.companyId, (tx) =>
        this.auditService.log(tx, {
          companyId: actor.companyId,
          actorUserId: actor.sub,
          action: 'bulk_import_completed',
          recordType: 'bulk_import',
          newValue: { importType, totalRows: rows.length, committed, failedCount: failed.length },
          ip: meta.ip,
        }),
      )
    }

    return { importType, committed, failed }
  }
}
