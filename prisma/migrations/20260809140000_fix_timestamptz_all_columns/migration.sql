-- Cross-cutting fix: every genuine point-in-time DateTime column in this
-- schema was mapped to Postgres's default `timestamp(3) without time zone`
-- instead of `timestamptz(3)` — a gap between the "timestamptz everywhere"
-- convention stated in CLAUDE.md and what Prisma actually does when a
-- DateTime field carries no explicit @db.Timestamptz(3) annotation (its
-- true default, undocumented anywhere in this repo until now). Found via a
-- direct `\d audit_entry` check showing `occurred_at` as `timestamp(3)
-- without time zone`.
--
-- This does NOT affect `@db.Date` fields (calendar-date-only columns like
-- `pv_case.awareness_date`, `pv_patient.date_of_birth`,
-- `reporting_rule.effective_from`, etc.) — those are correctly typed
-- already and are untouched by this migration.
--
-- Every existing value in every affected column is a naive
-- `timestamp without time zone` reading that has, in practice, always
-- been an effectively-UTC instant: Node's `Date` is internally always a
-- UTC epoch value, and Postgres's rule for a `timestamp without time
-- zone` column is to ignore any timezone marker on the input and store
-- the literal wall-clock digits it's given — so every value ever written
-- by this app is the correct UTC wall-clock reading, just missing the
-- zone marker on the column itself. `... USING "<col>" AT TIME ZONE
-- 'UTC'` below reinterprets each naive value as having been UTC all
-- along, which is a correct, non-shifting conversion. This was verified
-- empirically against a disposable scratch table before being applied
-- here: NOT using this USING clause (i.e. a bare `SET DATA TYPE
-- TIMESTAMPTZ(3)`, which is what Prisma's own `migrate diff` generates
-- unprompted) would have silently shifted every stored timestamp by this
-- server's session timezone offset (`Africa/Douala`, UTC+1) instead of
-- leaving the real instant unchanged — the exact bug this migration
-- exists to avoid, not just the one it exists to fix.
--
-- Also verified empirically before applying to real data: `ALTER COLUMN
-- ... TYPE` is DDL, not a DML UPDATE, so it is unaffected by
-- `audit_entry`/`signature_event`'s append-only `REVOKE UPDATE, DELETE`
-- + trigger enforcement (confirmed on a scratch table replicating that
-- exact trigger setup); a BRIN index on the converted column (matching
-- `audit_entry_occurred_at_brin_idx`) survives the type change and
-- remains correct with no manual rebuild needed (also confirmed on a
-- scratch table); and every column's DEFAULT (including
-- `CURRENT_TIMESTAMP`) survives the type change automatically.
--
-- The 8 DropIndex statements Prisma's own `migrate diff` also proposed
-- here (`audit_entry_occurred_at_brin_idx` and 7 pg_trgm indexes) are
-- hand-stripped as the known false positives documented in CLAUDE.md's
-- migration workflow — Prisma's diffing doesn't recognize indexes
-- created via raw SQL in earlier migrations, not a real schema change.

-- AlterTable
ALTER TABLE "app_user" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "audit_entry" ALTER COLUMN "occurred_at" SET DATA TYPE TIMESTAMPTZ(3) USING "occurred_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "auth_token" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "consumed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "consumed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "batch" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "company" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "company_market" ALTER COLUMN "activated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "activated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "company_registration" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "decided_at" SET DATA TYPE TIMESTAMPTZ(3) USING "decided_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "verification_code_expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "verification_code_expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "verification_last_sent_at" SET DATA TYPE TIMESTAMPTZ(3) USING "verification_last_sent_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "consent_record" ALTER COLUMN "granted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "granted_at" AT TIME ZONE 'UTC',
ALTER COLUMN "withdrawn_at" SET DATA TYPE TIMESTAMPTZ(3) USING "withdrawn_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "country" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "data_subject_request" ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "completed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "deadline" ALTER COLUMN "due_at" SET DATA TYPE TIMESTAMPTZ(3) USING "due_at" AT TIME ZONE 'UTC',
ALTER COLUMN "t72_notified_at" SET DATA TYPE TIMESTAMPTZ(3) USING "t72_notified_at" AT TIME ZONE 'UTC',
ALTER COLUMN "t24_notified_at" SET DATA TYPE TIMESTAMPTZ(3) USING "t24_notified_at" AT TIME ZONE 'UTC',
ALTER COLUMN "breached_at" SET DATA TYPE TIMESTAMPTZ(3) USING "breached_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "document" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "document_version" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "entitlement" ALTER COLUMN "granted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "granted_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "facility" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "form_schema" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "generated_report" ALTER COLUMN "due_at" SET DATA TYPE TIMESTAMPTZ(3) USING "due_at" AT TIME ZONE 'UTC',
ALTER COLUMN "submitted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "submitted_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "login_attempt" ALTER COLUMN "occurred_at" SET DATA TYPE TIMESTAMPTZ(3) USING "occurred_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "meddra_version" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "mfa_credential" ALTER COLUMN "enabled_at" SET DATA TYPE TIMESTAMPTZ(3) USING "enabled_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "notification" ALTER COLUMN "read_at" SET DATA TYPE TIMESTAMPTZ(3) USING "read_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "notification_preference" ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "permission" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "product" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "product_registration" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_adverse_event" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "meddra_coded_at" SET DATA TYPE TIMESTAMPTZ(3) USING "meddra_coded_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_call_log" ALTER COLUMN "occurred_at" SET DATA TYPE TIMESTAMPTZ(3) USING "occurred_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_case" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expectedness_assessed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expectedness_assessed_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_case_follow_up" ALTER COLUMN "cycle_started_at" SET DATA TYPE TIMESTAMPTZ(3) USING "cycle_started_at" AT TIME ZONE 'UTC',
ALTER COLUMN "closes_by_date" SET DATA TYPE TIMESTAMPTZ(3) USING "closes_by_date" AT TIME ZONE 'UTC',
ALTER COLUMN "last_response_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_response_at" AT TIME ZONE 'UTC',
ALTER COLUMN "next_check_due_at" SET DATA TYPE TIMESTAMPTZ(3) USING "next_check_due_at" AT TIME ZONE 'UTC',
ALTER COLUMN "closed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "closed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_case_follow_up_attempt" ALTER COLUMN "triggered_at" SET DATA TYPE TIMESTAMPTZ(3) USING "triggered_at" AT TIME ZONE 'UTC',
ALTER COLUMN "due_at" SET DATA TYPE TIMESTAMPTZ(3) USING "due_at" AT TIME ZONE 'UTC',
ALTER COLUMN "responded_at" SET DATA TYPE TIMESTAMPTZ(3) USING "responded_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_causality_assessment" ALTER COLUMN "assessed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "assessed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_duplicate_review" ALTER COLUMN "detected_at" SET DATA TYPE TIMESTAMPTZ(3) USING "detected_at" AT TIME ZONE 'UTC',
ALTER COLUMN "reviewed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "reviewed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_patient" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_pregnancy_context" ALTER COLUMN "follow_up_due_at" SET DATA TYPE TIMESTAMPTZ(3) USING "follow_up_due_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_reporter" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_source_document" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "redacted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "redacted_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pv_suspect_product" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "who_drug_coded_at" SET DATA TYPE TIMESTAMPTZ(3) USING "who_drug_coded_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "record_version" ALTER COLUMN "captured_at" SET DATA TYPE TIMESTAMPTZ(3) USING "captured_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "refresh_token" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMPTZ(3) USING "revoked_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "regulatory_authority" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "regulatory_submission" ALTER COLUMN "generated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "generated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "submitted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "submitted_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "report_type" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "reporting_rule" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "role" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "security_policy" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "seriousness_definition" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "signature_event" ALTER COLUMN "signed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "signed_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "submission_format" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "task" ALTER COLUMN "claimed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "claimed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "closed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "closed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "user_location_scope" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "who_drug_version" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "workflow_definition" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "workflow_instance" ALTER COLUMN "entered_at" SET DATA TYPE TIMESTAMPTZ(3) USING "entered_at" AT TIME ZONE 'UTC';
