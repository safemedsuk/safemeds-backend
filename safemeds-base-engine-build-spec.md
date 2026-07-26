# 🏗️ SafeMeds — Base Engine Master Build Spec

## Project: SafeMeds Compliance Platform — Shared Foundation (Backend + Frontend Wiring)

> **Last Updated:** 24 July 2026
> **Schema Source:** `safemeds-erd.mermaid` (root of workspace)
> **User Taxonomy:** `safemeds-user-types.md`
> **Stack:** NestJS · Prisma · PostgreSQL · JWT · Redis (BullMQ) · Next.js (v0 export) · TanStack Query · Zustand · Resend · Cloudflare R2 (S3 API)
> **Status Legend:** `- [ ]` = Not started · `- [x]` = Complete · `- [~]` = In progress / partial · `⚠️` = Has dependency
> **Convention:** every task specifies **BE** (backend) and/or **FE** (frontend wiring of the existing v0 screens). The frontend UI already exists from v0 — FE tasks mean *replacing `/lib/mock/` calls with real API calls*, never redesigning screens.

---

## Table of Contents

1. [Introduction — What This Backend Is](#introduction--what-this-backend-is)
2. [System-Wide API Conventions](#system-wide-api-conventions)
3. [Phase 0 — Backend Project Setup](#phase-0--backend-project-setup)
4. [Phase 1 — Authentication & Account Lifecycle](#phase-1--authentication--account-lifecycle)
5. [Phase 2 — Tenancy, RBAC & Row-Level Security](#phase-2--tenancy-rbac--row-level-security)
6. [Phase 3 — Audit Substrate](#phase-3--audit-substrate)
7. [Phase 4 — Country Rules Engine](#phase-4--country-rules-engine)
8. [Phase 5 — Workflow Engine & Deadlines](#phase-5--workflow-engine--deadlines)
9. [Phase 6 — Electronic Signatures](#phase-6--electronic-signatures)
10. [Phase 7 — Master Data](#phase-7--master-data)
11. [Phase 8 — Documents & Storage](#phase-8--documents--storage)
12. [Phase 9 — Task Inbox & Notifications](#phase-9--task-inbox--notifications)
13. [Phase 10 — Hardening & Production Readiness](#phase-10--hardening--production-readiness)
14. [Dependency Map](#dependency-map)
15. [Future Modules (append below this line)](#future-modules)

---

## Introduction — What This Backend Is

This document specifies the **base engine** of SafeMeds: the multi-tenant, GxP-grade compliance backbone on which VigiCloud (pharmacovigilance), QualCloud (quality management), and RegCloud (regulatory affairs) will all run. The engine is not a module — it is the platform. Every module added to this file later (Phase 11+) will consume the services built here and add only its domain tables, its workflow definitions, and its screens.

**What the engine provides to every current and future module:**

- **Tenancy** — every customer company is an isolated tenant. Isolation is enforced in the database itself (PostgreSQL row-level security), not merely in application code. A bug in a service can never leak one tenant's data to another, because Postgres refuses to return it.
- **Identity & RBAC** — platform-defined pharmaceutical roles, permission-gated endpoints, and the strict separation of platform-side (SafeMeds staff) and tenant-side users defined in `safemeds-user-types.md`.
- **Audit substrate** — an append-only, database-immutable record of every create, update, state change, and signature across the entire system. Nothing in SafeMeds is ever edited silently and nothing is ever deleted; this is what makes a SafeMeds record a *compliance* record.
- **Country rules engine** — every regulatory difference between markets (reporting windows, seriousness definitions, capture forms, submission formats) is configuration data, versioned and pinned to records. Kenya is the first configured country, never a special case in code. Crossing a border is a data change, not a release.
- **Workflow engine** — record lifecycles (states, role-gated transitions, signature requirements, deadlines) defined as data. A case cannot skip Medical Review because no transition row exists — enforcement by structure, not by discipline.
- **Electronic signatures** — re-authenticated signing events with cryptographic record hashes, legally equivalent to handwritten signatures under GxP expectations.
- **Master data** — products, batches, registrations, and the MedDRA dictionary, shared by all modules so a batch number in a safety case links to the same row a quality record references.
- **Documents, tasks, and notifications** — versioned hash-verified file storage, and the task-inbox layer that is the primary daily experience for most users.

**Enterprise scale posture:** this platform is being built for pan-African scale. Every list endpoint is paginated from day one (no unpaginated collection endpoints exist, period), every query path is indexed, all timestamps are UTC (`timestamptz`), all money-critical/deadline-critical computation is server-side, and the API is versioned (`/api/v1`) so mobile clients in the field never break on deploy. Standards below are non-negotiable and apply to every phase, including future modules.

---

## System-Wide API Conventions

> Established once in Phase 0; every endpoint in every phase conforms. Reference this section instead of repeating it.

- **Base path:** `/api/v1`. Swagger/OpenAPI served at `/api/docs` (disabled in production or auth-gated).
- **Response envelope:** success → `{ "data": ..., "meta": { ...optional } }`; error → `{ "error": { "code": "MACHINE_CODE", "message": "human text", "details": [...] } }`. HTTP status codes used correctly (400 validation, 401 unauthenticated, 403 forbidden, 404, 409 conflict/version, 423 locked, 429 throttled).
- **Pagination (standard for EVERY list):** query `?page=1&limit=25` (limit max 100, default 25) → `meta: { page, limit, total, totalPages }`. Sorting via `?sort=field:asc|desc` from an allow-list per endpoint. Filtering via documented query params. High-volume append-only streams (audit, notifications) additionally support cursor pagination `?cursor=<id>&limit=` for stable deep scrolling.
- **Validation:** global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; every input is a class-validator DTO. Nothing reaches a service unvalidated.
- **IDs:** UUID v7 (time-ordered) for all primary keys.
- **Dates:** ISO-8601 UTC strings on the wire; `timestamptz` in Postgres; the server never trusts client clocks for anything regulatory.
- **Auth transport:** access JWT (15 min) + rotating refresh token (7 days), both delivered as `httpOnly; Secure; SameSite=Lax` cookies. **Never localStorage.** CSRF protection via double-submit token on state-changing requests.
- **Optimistic concurrency:** mutable records carry `version int`; updates require the client's version and return 409 on mismatch (this also powers future offline conflict surfacing).
- **Frontend wiring convention (all FE tasks):** create `frontend/lib/api/client.ts` (fetch wrapper: base URL, credentials include, envelope unwrap, error normalization, 401→refresh→retry-once) and per-domain files `lib/api/<domain>.ts` exporting typed functions consumed by TanStack Query hooks. Mock repositories in `/lib/mock/` are deleted domain-by-domain as each phase's wiring completes.

---

## Phase 0 — Backend Project Setup

> ⚠️ The backend does not exist yet. Nothing else can start before 0.1–0.4.
### 0.0 Environmental variable setup
- [ ] Make sure to alway use alot of configuration in env so that things that are general can be changed like api keys for uploads, or third party api intergrations and stuff like that, even expiry tokens periods etc and much more.

### 0.1 Repository & Tooling

- [ ] **BE** Create `backend/` alongside existing `frontend/` and `website/` folders. Initialize with Nest CLI (`nest new backend --strict`), pnpm, TypeScript `strict: true`.
- [ ] **BE** ESLint + Prettier aligned with the frontend config; `simple-import-sort`; commit hooks via husky + lint-staged.
- [ ] **BE** `docker-compose.yml` at repo root: `postgres:16` (volume, port 5432) + `redis:7` (BullMQ). One command brings up local infra.
- [ ] **BE** `@nestjs/config` with a **Zod-validated env schema** (`env.validation.ts`) — the app refuses to boot with missing/invalid env. Create `.env.example` documenting every variable (DATABASE_URL, JWT secrets, RESEND_API_KEY, R2 credentials, REDIS_URL, APP_URL...).
- [ ] **BE** Structured logging with `nestjs-pino`: request-id per request (also returned as `X-Request-Id` header), redaction of auth headers/cookies, pretty in dev, JSON in prod.
- [ ] **BE** Module skeleton: `src/modules/{auth,tenancy,rbac,audit,countries,workflow,signatures,master-data,documents,tasks,notifications,platform}` + `src/common/{decorators,guards,interceptors,filters,pagination}` + `src/prisma`.

### 0.2 Prisma & Database Workflow

- [ ] **BE** `prisma init`; `PrismaService` (extends PrismaClient, `onModuleInit` connect, graceful shutdown) provided by a global `PrismaModule`.
- [ ] **BE** Translate `safemeds-erd.mermaid` into `schema.prisma` incrementally per phase (each phase lists its models). Naming: `@@map` to snake_case tables, camelCase in client.
- [ ] **BE** Migration discipline: `prisma migrate dev` for schema; **hand-written SQL inside migration files** for everything Prisma cannot express — RLS policies, `REVOKE UPDATE, DELETE`, partial indexes, triggers. These raw statements live in the same migration history so every environment is reproducible. Never `db push` outside local experiments.
- [ ] **BE** `prisma/seed.ts` (idempotent upserts) — grows per phase: roles & permissions (P2), countries & Kenya config (P4), workflow definitions (P5), demo tenant for dev.

### 0.3 Global API Infrastructure

- [ ] **BE** Global `ValidationPipe` per conventions; global exception filter mapping all errors (incl. Prisma known errors: P2002 unique → 409, P2025 not found → 404) to the error envelope; `TransformInterceptor` wrapping success responses in `{ data }`.
- [ ] **BE** `PaginationQueryDto` (page, limit, sort with allow-list validation) + `paginate()` helper returning `{ data, meta }` — used by literally every list endpoint from here on.
- [ ] **BE** Security baseline: `helmet`, strict CORS (frontend origin from env, `credentials: true`), `@nestjs/throttler` global default (e.g. 100 req/min per IP) with stricter per-route overrides in Phase 1, body size limits, cookie-parser.
- [ ] **BE** `GET /api/v1/health` (liveness) and `/health/ready` (checks Postgres + Redis). Swagger setup with cookie-auth scheme documented.
- [ ] **BE** Sentry SDK wired via env flag.

### 0.4 Testing Baseline

- [ ] **BE** Jest unit config + one e2e config using a dedicated `safemeds_test` database (migrated + truncated between suites). Write the first e2e: health endpoint + validation error shape.
- [ ] **BE** GitHub Actions workflow: lint → typecheck → unit → e2e (services: postgres, redis) on every PR.

---

## Phase 1 — Authentication & Account Lifecycle

> ⚠️ Depends on Phase 0. Models introduced: `User`, `Company`, `CompanyRegistration`, `EmailVerificationCode`, `RefreshToken`, `Invitation`, `PasswordResetToken`, `MfaCredential`, `RecoveryCode`, `LoginAttempt`, `SecurityPolicy`.

### 1.1 Auth Module Scaffold & Token Architecture

- [ ] **BE** Password hashing with **argon2id** (`argon2` package; memory 64MB, time 3) behind a `PasswordService` (hash, verify, policy check: ≥12 chars, upper/lower/digit/symbol, must not contain name/company — mirror the FE checklist exactly so both agree).
- [ ] **BE** JWT strategy (`@nestjs/passport` + `passport-jwt`, custom cookie extractor): access token 15 min carrying `{ sub, companyId, roleKeys[], platformRole?, tokenVersion }`; refresh token 7 days, **opaque random 256-bit**, stored **hashed (sha256)** in `RefreshToken` with device metadata, rotated on every use, reuse-detection revokes the whole family.
- [ ] **BE** Global `JwtAuthGuard` (everything requires auth by default) + `@Public()` decorator for the explicit open endpoints (register, login, verify, forgot/reset, invite acceptance, health).
- [ ] **BE** CSRF: issue readable `csrf` cookie at login; custom guard requires matching `X-CSRF-Token` header on POST/PATCH/DELETE.
- [ ] **FE** Build `lib/api/client.ts` per conventions (credentials include, 401 → `/auth/refresh` → retry once → hard logout on failure). Zustand auth store holds only user profile + boolean session state — never tokens.

### 1.2 Company Registration

- [ ] **BE** `POST /auth/register-company` (@Public, throttled 3/hour/IP): DTO validates company details (name, type enum incl. `e_pharmacy`, countryId, licenceNumber) + admin details + password policy. Creates `CompanyRegistration(status: pending_verification)` with a mono reference number (`REG-2026-XXXXX`); admin password hashed immediately; **no `Company` or `User` row exists yet**.
- [ ] **BE** Licence upload: `POST /auth/register-company/:ref/licence` — accepts the file (10MB limit, pdf/jpg/png magic-byte sniffed, not just extension), streams to R2 under `registrations/{ref}/`, stores key + sha256 on the registration. (Uses the storage service from Phase 8 §8.1 — build that service early if sequencing demands; it has no other dependencies.)
- [ ] **FE** Wire the 5-step wizard to these endpoints; wizard draft persists in Zustand (never the password); upload with progress; step 5 shows the reference number from the API.

### 1.3 Email Verification

- [ ] **BE** 6-digit numeric code, stored **hashed** with 15-min TTL and max 5 attempts; `POST /auth/verify-email` transitions registration → `under_review`; `POST /auth/resend-code` throttled 1/60s. Email via a `MailService` wrapping **Resend** + React Email templates (verification, approval, rejection, invitation, reset — one template file each, brand tokens).
- [ ] **FE** Wire the 6-box code component: submit, error on wrong code with attempts remaining, resend with server-driven cooldown.

### 1.4 Registration Review & Approval (platform-side)

- [ ] **BE** Platform-guarded endpoints: `GET /platform/registrations?status=&page=` (paginated, with computed flags: free-mail domain, domain/name mismatch), `GET /platform/registrations/:id` (+ licence presigned view URL), `POST .../approve`, `POST .../reject { reason }`. Approval is **one transaction**: create `Company(status: active)` → create admin `User` with `SYSTEM_ADMINISTRATOR` role → default `SecurityPolicy` → audit entries (registration + verification evidence: reviewer, registerChecked, timestamp) → approval email with login link. Rejection emails the reason.
- [ ] **FE** Wire `/internal/registrations` queue: list + filters + document preview via presigned URL + approve/reject with confirmation; verification history rendered from audit.

### 1.5 Login, Lockout & Sessions

- [ ] **BE** `POST /auth/login` (@Public, throttled): verify against active `User` (company must be `active`), generic `INVALID_CREDENTIALS` for wrong email OR password (never reveal existence); distinct codes for `ACCOUNT_DEACTIVATED`, `COMPANY_SUSPENDED`, `ACCOUNT_LOCKED` (423, with `unlockAt`). Record every attempt in `LoginAttempt`; **5 failures / 15 min per account ⇒ lock 15 min** + audit entry. Success ⇒ set cookies, write audit `login`, return profile.
- [ ] **BE** `POST /auth/refresh` (rotation per 1.1), `POST /auth/logout` (revoke current), `GET /auth/sessions` (paginated device list), `DELETE /auth/sessions/:id` and `/auth/sessions` (all others). `tokenVersion` on User invalidates all access tokens instantly when bumped (deactivation, password reset).
- [ ] **FE** Wire login incl. all four error states and the live lockout countdown from `unlockAt`; wire the security-settings active-sessions table; idle-timeout modal driven by the company policy value fetched at login.

### 1.6 Multi-Factor Authentication

- [ ] **BE** TOTP via `otplib`: `POST /auth/mfa/setup` (returns otpauth URI + QR data; secret stored encrypted-at-rest with AES-256-GCM under an env key), `POST /auth/mfa/verify-setup` (activates + returns 8 recovery codes shown once, stored hashed), `POST /auth/mfa/challenge` (login step 2: short-lived `mfa_pending` token → code or recovery code → full session), `POST /auth/mfa/disable` (requires re-auth), `POST /auth/mfa/recovery-codes/regenerate` (requires re-auth). Company policy flag `mfaRequiredForSignatureRoles` enforced at login for QPPV/Quality Manager/Reg Affairs.
- [ ] **FE** Wire setup (QR + manual key + verify + recovery-code grid), challenge screen, and management section in security settings.

### 1.7 Password Lifecycle

- [ ] **BE** `POST /auth/forgot-password` (@Public, throttled, always 200 with identical body); single-use token (256-bit, hashed, 30-min TTL). `POST /auth/reset-password` validates token, applies policy, bumps `tokenVersion` (all sessions out), revokes refresh family, audits, emails confirmation. `POST /auth/change-password` (authenticated: current + new). Admin-triggered reset (`POST /users/:id/reset-password`) sets `mustChangePassword` → login returns `PASSWORD_CHANGE_REQUIRED` until cleared.
- [ ] **FE** Wire forgot/reset/change + the forced-change interstitial on the login response code.

### 1.8 Invitations (the only way users are created)

- [ ] **BE** Tenant-admin endpoints: `POST /invitations { email, roleKeys[] }` (validates roles against catalog, single-use 256-bit token hashed, 7-day expiry, email via Resend), `GET /invitations?status=&page=`, `POST /invitations/:id/resend` (new token), `DELETE /invitations/:id` (revoke). @Public: `GET /auth/invitations/:token` (company, inviter, roles — 410 if expired/revoked, offering "request new" which notifies the admin), `POST /auth/invitations/:token/accept { fullName, password }` → creates User with the **pre-assigned** roles inside a transaction, marks invitation accepted, then email verification (1.3 component) → session.
- [ ] **FE** Wire invite acceptance flow + expired/revoked states; wire the pending-invitations tab (list/resend/revoke) in `/admin/users`.

### 1.9 Re-Authentication for Signatures

- [ ] **BE** `POST /auth/reauth { password, mfaCode? }` → issues a **signature-grade token**: 5-min TTL, single-use (jti stored in Redis, deleted on consumption), scoped `purpose: signature`. This is the only token the signature service (Phase 6) accepts. Audit `reauth` events including failures.
- [ ] **FE** The gold signature modal calls reauth first, then the signing endpoint with the returned token; on TTL expiry mid-flow, modal cleanly restarts.

### 1.10 Security Policy (per company)

- [ ] **BE** `SecurityPolicy` model (minPasswordLength ≥12 floor, sessionTimeoutMinutes, mfaRequiredForSignatureRoles) with `GET/PATCH /company/security-policy` (tenant admin; PATCH audited). Login response includes the policy values the client needs.
- [ ] **FE** Wire the policy card in `/admin/users`.

---

## Phase 2 — Tenancy, RBAC & Row-Level Security

> ⚠️ Depends on Phase 1 (users exist). Models: `Role`, `Permission`, `RolePermission`, `UserRole` (+ `Company`, `User` from P1).

### 2.1 Role & Permission Catalog

- [ ] **BE** Seed the full catalog from `safemeds-user-types.md`: 8 tenant roles (incl. `EXECUTIVE_READONLY`) + 3 platform roles; permissions namespaced `domain.action` (`users.invite`, `cases.approve_submission`, `audit.read`, `platform.registrations.review`, ...). Seed the role→permission matrix exactly as the capability table specifies.
- [ ] **BE** `GET /roles` (catalog with descriptions — powers invite UI), `GET /users?page=&status=&role=` , `PATCH /users/:id/roles` (audited), `POST /users/:id/deactivate` (audited; bumps tokenVersion; **no delete endpoint exists**).

### 2.2 Guards & Decorators

- [ ] **BE** `PermissionsGuard` + `@RequirePermissions('x.y')` reading the user's permission set (roleKeys resolved → cached per-request); `PlatformGuard` + `@PlatformOnly(...roles)` for `/platform/*`; guards compose with the global JwtAuthGuard. Unit-test the matrix: every role × a representative endpoint.
- [ ] **FE** `usePermissions()` hook from the login profile; hide/disable UI actions the user lacks — while treating the server as the real enforcer.

### 2.3 Tenant Context & Postgres RLS

- [ ] **BE** RLS migration (raw SQL): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `FORCE` on every tenant-owned table; policy `USING (company_id = current_setting('app.company_id')::uuid)`; the app's DB role owns nothing and cannot bypass RLS.
- [ ] **BE** Prisma client extension: every query runs inside a transaction that first executes `SET LOCAL app.company_id = $1` from the JWT claim (interceptor binds it per request via AsyncLocalStorage). Platform-side reads use an explicit `withPlatformAccess(reason)` wrapper that sets a privileged setting AND writes the `platform_access` audit entry — cross-tenant access is impossible to do silently, by construction.
- [ ] **BE** e2e proof test: user of company A requests a company B resource by ID → 404 (not 403 — do not confirm existence), even when service code "forgets" a where-clause.

---

## Phase 3 — Audit Substrate

> ⚠️ Depends on Phase 2 (actor + tenant context). Model: `AuditEntry` (append-only).

### 3.1 Immutable Store

- [ ] **BE** Migration (raw SQL): `audit_entry` table per ERD; `REVOKE UPDATE, DELETE ON audit_entry FROM app_role`; BRIN index on `occurred_at`, btree on `(company_id, record_type, record_id, occurred_at)`. A DB trigger raising an exception on UPDATE/DELETE as belt-and-braces.
- [ ] **BE** `AuditService.log({ recordType, recordId, action, oldValue, newValue, actor })` — called **inside the same transaction** as the change it records (an audited change and its audit entry commit or roll back together). Actor context injected from the request ALS; `actor: system` supported for jobs. Field-level diffing helper produces minimal old/new JSONB (redacting `passwordHash` and secrets by deny-list).

### 3.2 Emission & Query

- [ ] **BE** Wire `AuditService` into every mutating service from Phases 1–2 retroactively (registration decisions, logins, lockouts, role changes, policy changes, deactivations) — grep-proof: no service commits a regulated change without an audit call in-transaction.
- [ ] **BE** `GET /audit?recordType=&recordId=&actorId=&action=&from=&to=&page=|cursor=` (permission `audit.read`; tenant-scoped by RLS automatically) and `GET /records/:type/:id/history` for the reusable Activity tab.
- [ ] **FE** Wire `/audit` screen (filters, cursor infinite scroll, old→new diff expansion) and the shared record-history component.

---

## Phase 4 — Country Rules Engine

> ⚠️ Depends on Phase 3 (config changes are audited). Models: `Country`, `RegulatoryAuthority`, `ReportingRule`, `SeriousnessDefinition`, `FormSchema`, `SubmissionFormat`.

### 4.1 Models & Seed

- [ ] **BE** Prisma models per ERD, all config tables versioned (`version`, `status: draft|active|retired`, `effectiveFrom`); partial unique index enforcing **one active version** per natural key (raw SQL in migration).
- [ ] **BE** Seed countries + authorities (KE/PPB, UG/NDA, TZ/TFDA, RW/Rwanda FDA, ET/EFDA, NG/NAFDAC, ZA/SAHPRA, GH/Ghana FDA). Seed Kenya's rules **marked `unverified: true`** — ⚠️ the 7-day vs 15-day PPB windows conflict between source documents is UNRESOLVED; the seed carries both candidate rows disabled until expert confirmation (tracked in `safemeds-domain-knowledge.md` Open Questions).

### 4.2 Configuration API (version-on-write)

- [ ] **BE** `GET /countries?configured=true`, `GET /countries/:id/config` (full tree), and per-type endpoints: list (paginated) + `POST .../versions` — **there is no PUT/edit**; changing any rule creates a new version and retires the old (transaction + audit). Activation endpoint flips draft→active.
- [ ] **BE** `RuleResolutionService`: `resolveReportingRule(authorityId, eventClass, seriousnessClass, asOfDate)` and `resolveFormSchema(countryId, recordType)` — pure, deterministic, exhaustively unit-tested (this function computes legal deadlines; it gets the best test coverage in the codebase).
- [ ] **FE** Wire the country console: config tree per country, versioned tables, "saving creates version N+1" flows, schema preview from the real `json_schema`.

---

## Phase 5 — Workflow Engine & Deadlines

> ⚠️ Depends on Phases 2–4. Models: `WorkflowDefinition`, `WorkflowState`, `WorkflowTransition`, `WorkflowInstance`, `Deadline`.

### 5.1 Definitions

- [ ] **BE** Models per ERD; seed the PV case workflow v1 (Intake → Triage → Medical Review → Coding → Narrative → Quality Check → Submission Ready → Submitted) with role gates and `requiresSignature` on the QPPV approval transition. Definition endpoints: list/detail (read-mostly for MVP; authoring UI is future).
- [ ] **BE** `WorkflowService.instantiate(recordType, recordId, countryId)` — resolves the active definition (country-specific else default), creates the instance at the initial state, audits.

### 5.2 Transitions — the enforcement core

- [ ] **BE** `WorkflowService.transition(instanceId, toStateKey, actor, signatureToken?)` in ONE transaction: load instance with row lock → verify a transition row exists from current state → verify actor holds the required role → if `requiresSignature`, require and consume a valid signature-grade token and create the `SignatureEvent` (Phase 6) → update state → audit `state_change` → emit domain event for task/deadline hooks. Every failure is a distinct 4xx code (`TRANSITION_NOT_ALLOWED`, `ROLE_REQUIRED`, `SIGNATURE_REQUIRED`).
- [ ] **BE** `GET /workflow/instances/:id/available-transitions` (computed for the current user — powers FE action buttons).
- [ ] **FE** Wire the workflow viewer screen and the record-detail stepper + action buttons from `available-transitions`.

### 5.3 Deadlines & Escalation

- [ ] **BE** `DeadlineService.computeFor(record)` using `RuleResolutionService` (clock start = awareness date; calendar vs business days honored); stored on `Deadline`; `recompute()` on seriousness reclassification writes an audit entry with old→new due date. BullMQ repeatable job (hourly) scans approaching/breached deadlines → escalating tasks + notifications (T-72h owner, T-24h owner+supervisor, breach → both + audit `deadline_missed`).
- [ ] **FE** Deadline chips and urgency colors across inbox/lists driven by real `dueAt`.

---

## Phase 6 — Electronic Signatures

> ⚠️ Depends on Phases 1.9, 3, 5. Model: `SignatureEvent` (append-only like audit — same REVOKE migration pattern).

- [ ] **BE** `SignatureService.sign({ recordType, recordId, intentStatement, signatureToken })`: consume the single-use re-auth token → produce **canonical serialization** of the record (stable key ordering, documented field set per record type) → SHA-256 → persist SignatureEvent (signer, `roleAtSigning` copied as string, intent, timestamp, hash) → audit `sign`. `GET /records/:type/:id/signatures` and `POST /signatures/:id/verify` (recompute hash → `intact: boolean`).
- [ ] **FE** Wire the gold modal end-to-end (reauth → sign → success view showing the signature record); Signatures tab on record detail; verify action for admins.

---

## Phase 7 — Master Data

> ⚠️ Depends on Phase 2. Models: `Product`, `Batch`, `ProductRegistration`, `MeddraVersion`, `MeddraTerm`.

- [ ] **BE** CRUD (create/read/update — deactivate, never delete) for products, batches, registrations; all lists paginated with search (`?q=` over name/number via trigram indexes — raw SQL `pg_trgm`); registrations list supports `?expiringWithinDays=` (the future RegCloud renewals query, born here).
- [ ] **BE** MedDRA: models per ERD; CLI import command (`nest-commander`) for MSSO release files ⚠️ **blocked on MedDRA licence — commercial dependency flagged to CEO**; until then a seeded mock subset (~200 realistic terms across the hierarchy) keeps development honest. `GET /meddra/search?q=&version=` optimized for typeahead (trigram + level filter).
- [ ] **FE** Wire products/batches/registrations screens to real endpoints through the shared DataTable (server-side pagination/sort/filter params).

---

## Phase 8 — Documents & Storage

> ⚠️ 8.1 has no dependencies (Phase 1.2 consumes it). Models: `Document`, `DocumentVersion`.

- [ ] **BE** §8.1 `StorageService` over the **S3 SDK pointed at Cloudflare R2** (endpoint/credentials from env — swapping to AWS S3 later is config only): `presignUpload(key, contentType, maxSize)`, `presignDownload(key, ttl)`, server-side sha256 verification on completion.
- [ ] **BE** Document endpoints: `POST /records/:type/:id/documents` (register upload intent → presigned URL), `POST /documents/:id/versions/:vId/complete` (verify sha256, mark stored), `GET /records/:type/:id/documents` (versions with hashes), presigned `GET` for viewing. New upload = new version, never overwrite; bucket versioning + object lock (compliance mode) enabled on the compliance bucket.
- [ ] **FE** Wire upload zones (licence upload switches from the temporary 1.2 path to this service) and the Documents tab with hash display + version history.

---

## Phase 9 — Task Inbox & Notifications

> ⚠️ Depends on Phase 5 (tasks are born from workflow/deadline events). Models: `Task`, `Notification`.

- [ ] **BE** Task generation hooks on workflow events: entering a state creates the acting-role's task (role-queue) or assigned-user task; completing a transition closes it; deadline escalations create urgency-flagged tasks. `GET /tasks?scope=me|role|all&recordType=&urgency=&page=` with computed urgency buckets; `POST /tasks/:id/claim` (role-queue → me, audited); summary endpoint for the header counts.
- [ ] **BE** `NotificationService`: in-app rows + email via Resend through a BullMQ queue (retry/backoff); `GET /notifications?cursor=`, `POST /notifications/:id/read`, unread-count endpoint; per-user channel preferences (minimal: email on/off per category).
- [ ] **FE** Wire the inbox (filters, urgency summary, claim, task drawer → record), the bell (unread count + list), and mark-read.

---

## Phase 10 — Hardening & Production Readiness

- [ ] **BE** Per-route throttle audit (auth endpoints strictest); dependency audit (`pnpm audit`); secrets never in logs (pino redaction verified); Postgres automated backups + tested restore runbook; Sentry release tagging; uptime monitor on `/health`.
- [ ] **BE** Load-sanity: seed 50k audit rows + 5k tasks in staging; verify every list stays <300ms (indexes prove themselves).
- [ ] **BE+FE** Full demo path e2e (the same 10-step path as the v0 QA checklist) against the real stack in staging.
- [ ] **OPS** Deploy: Neon (Postgres) + Upstash (Redis) + Render/Railway (API) + Vercel (frontend) + R2; env parity checked against `.env.example`. ⚠️ Before the first paying customer: move API off free tier (no cold starts on a deadline-driven product).

---

## Dependency Map

```
Phase 0 (Setup) ──────────────────────────────────────────────┐
   └── Phase 1 (Auth & Accounts) ⚠️ uses 8.1 StorageService    │
          └── Phase 2 (Tenancy, RBAC, RLS)                     │
                 └── Phase 3 (Audit) ── wires back into P1–P2  │
                        └── Phase 4 (Country Rules)            │
                               └── Phase 5 (Workflow+Deadlines)│
                                      ├── Phase 6 (Signatures) │
                                      └── Phase 9 (Tasks/Notif)│
                 └── Phase 7 (Master Data)                     │
   └── Phase 8 (Documents/Storage) — 8.1 early, rest after P3  │
Phase 10 (Hardening) ── runs continuously, gates production ───┘

Future modules consume everything above:
Phase 11 → VigiCloud · Phase 12 → Offline Mobile Sync · Phase 13 → AI Coding · Phase 14 → QualCloud · Phase 15 → RegCloud
```

---

## Future Modules

> Append VigiCloud (Phase 11), Offline Mobile (12), AI Coding (13), QualCloud (14), RegCloud (15) below, following the same format: models per phase, BE/FE split per task, pagination and audit conventions inherited from this document without restatement.
