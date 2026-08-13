import { AuthenticatedUser } from '../../../common/interfaces/authenticated-user.interface'

export interface ImporterColumn {
  key: string
  label: string
  required: boolean
  /**
   * Extra header spellings a real spreadsheet might use, matched
   * case-insensitively after trimming (e.g. `["Role", "Roles", "Role
   * Name"]` for a `roleKeys` column) — `BulkImportService` remaps any
   * matching header onto `key` before validation runs, so a business
   * user's own column naming doesn't have to match the technical field
   * name exactly.
   */
  aliases?: string[]
}

export interface RequestMeta {
  ip?: string
}

/**
 * VigiCloud Stage 0.6 — one entry per supported bulk-import target,
 * registered in `BulkImportService`'s `IMPORTERS` map. Generalizes the
 * shape of the existing MedDRA CLI importer (Phase 7 —
 * `src/commands/import-meddra.command.ts`: parse rows, validate, commit)
 * into something a client can drive over HTTP, one row's outcome at a
 * time rather than one all-or-nothing transaction — a single bad row
 * (e.g. an email that's already registered) shouldn't abort hundreds of
 * good ones, unlike the MedDRA import's single global-reference-data
 * transaction.
 *
 * Only `user_invite` exists today, reusing `InvitationsService.create()`
 * row-by-row rather than duplicating its validation/token/email logic.
 * Stage 2's `product` importer and Stage 14's `clinical_trial_patient`
 * importer register here the same way, once those domain tables exist.
 */
export interface Importer {
  importType: string
  label: string
  columns: ImporterColumn[]
  /**
   * The permission an actor needs to run this specific importer —
   * checked by `BulkImportService` against `:importType` at request time
   * (not a static `@RequirePermissions()` on the controller, since which
   * permission applies depends on the route param). `user_invite` needs
   * `users.invite`; `product` (Stage 2) needs `master_data.manage`; a
   * future importer declares its own rather than reusing either.
   */
  requiredPermission: string
  /** Returns a list of human-readable errors; empty means the row is valid. Never mutates anything. */
  validateRow(row: Record<string, string>): string[]
  /** Only called for rows that passed `validateRow`. Throws on failure — the caller catches and records it per-row. */
  commitRow(actor: AuthenticatedUser, row: Record<string, string>, meta: RequestMeta): Promise<void>
}
