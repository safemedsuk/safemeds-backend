/**
 * The single, centrally-defined max upload size for every multipart file
 * upload endpoint in this app (licences, permits, PV source documents,
 * recall evidence, QPPV nomination confirmations, SDEA documents, training
 * certificates, CoA documents, waste disposal certificates, validation
 * protocol/report documents, DHCP letter evidence, regulatory submission
 * evidence, import/export permits, GMP/facility/personnel licences, etc.).
 *
 * Chosen value: 10MB. A real regulatory PDF/scan (multi-page, scanned at a
 * legible resolution) routinely runs several MB — an aggressively small
 * cap (e.g. 1MB, floated as a possible number during a real-usage bug
 * report) would itself become a recurring support complaint ("my
 * perfectly normal document won't upload") rather than a genuine
 * safeguard. 10MB already matched `UPLOAD_MAX_FILE_SIZE_MB`'s own env
 * default (`src/config/env.validation.ts`) and every controller's own
 * previously-duplicated `FileInterceptor` limit — this constant replaces
 * those 10+ separate hardcoded `10 * 1024 * 1024` literals with one
 * source of truth, matching this codebase's own "centralize, don't
 * duplicate" discipline (see CLAUDE.md's gotchas list).
 *
 * `FileInterceptor()`'s own `limits.fileSize` option is evaluated at
 * decorator-evaluation time (module load), before Nest's DI/ConfigService
 * exist — so this must stay a plain synchronous constant, not read from
 * `ConfigService`. `DocumentsService`/`RegistrationService` etc. still
 * independently re-check against the real configured
 * `UPLOAD_MAX_FILE_SIZE_MB` value once they do have `ConfigService` — this
 * constant is only the outer, multer-level backstop and must be kept in
 * sync with that env default.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export const MAX_UPLOAD_MB = 10
