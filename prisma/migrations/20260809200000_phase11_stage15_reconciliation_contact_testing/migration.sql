-- VigiCloud Phase 11 Stage 15 — Reconciliation (15.1) + Contact Testing
-- (15.2).
--
-- 15.1: `distributor` (a manufacturer tenant's own list of its
-- distributors, per the user's own note — "All our manufacturers would
-- have a list of their distributors on accounts"), `case_distributor_mapping`
-- (persisted only for a case needing human reconciliation attention — a
-- clean auto-match between `Reporter.organization` and a listed
-- `Distributor.name` is resolved live at report time, never redundantly
-- stored), and `reconciliation_report` (an archived, never-mutated
-- snapshot per generation, matching `RegulatorySubmission`'s own
-- "generate again, don't overwrite" precedent).
--
-- 15.2: `contact_test` + `contact_test_attempt` — tests whether a
-- contact channel (a mailbox, a phone line) is reachable at all,
-- independent of any one case, via the same two-trigger retry shape
-- Stage 11's case follow-up already established (a fresh 5-calendar-day
-- window for email, immediate for phone).
--
-- The 8 DropIndex statements `prisma migrate diff` also proposed here
-- (the BRIN index + 7 pg_trgm indexes) are hand-stripped as the known
-- false positives documented in CLAUDE.md's migration workflow.

-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "ContactTestChannel" AS ENUM ('email', 'phone');

-- CreateEnum
CREATE TYPE "ContactTestStatus" AS ENUM ('pending_attempt_1', 'pending_attempt_2', 'reached', 'unsuccessful');

-- CreateEnum
CREATE TYPE "ContactTestAttemptOutcome" AS ENUM ('reached', 'no_response');

-- CreateTable
CREATE TABLE "distributor" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "country_id" UUID,
    "distributor_company_id" UUID,
    "status" "DistributorStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_distributor_mapping" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "distributor_id" UUID,
    "reconciled_by" UUID NOT NULL,
    "reconciled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "case_distributor_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_report" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "distributor_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_cases" INTEGER NOT NULL,
    "matched_cases" INTEGER NOT NULL,
    "unmatched_cases" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_test" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel" "ContactTestChannel" NOT NULL,
    "contact_value" TEXT NOT NULL,
    "purpose" TEXT,
    "status" "ContactTestStatus" NOT NULL DEFAULT 'pending_attempt_1',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "window_due_at" TIMESTAMPTZ(3) NOT NULL,
    "initiated_by" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_test_attempt" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contact_test_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" "ContactTestAttemptOutcome" NOT NULL,
    "logged_by" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_test_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distributor_company_id_status_idx" ON "distributor"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_company_id_name_key" ON "distributor"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "case_distributor_mapping_case_id_key" ON "case_distributor_mapping"("case_id");

-- CreateIndex
CREATE INDEX "reconciliation_report_company_id_generated_at_idx" ON "reconciliation_report"("company_id", "generated_at");

-- CreateIndex
CREATE INDEX "contact_test_company_id_status_idx" ON "contact_test"("company_id", "status");

-- AddForeignKey
ALTER TABLE "distributor" ADD CONSTRAINT "distributor_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor" ADD CONSTRAINT "distributor_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor" ADD CONSTRAINT "distributor_distributor_company_id_fkey" FOREIGN KEY ("distributor_company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_distributor_mapping" ADD CONSTRAINT "case_distributor_mapping_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_distributor_mapping" ADD CONSTRAINT "case_distributor_mapping_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_distributor_mapping" ADD CONSTRAINT "case_distributor_mapping_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_distributor_mapping" ADD CONSTRAINT "case_distributor_mapping_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_report" ADD CONSTRAINT "reconciliation_report_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_report" ADD CONSTRAINT "reconciliation_report_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_report" ADD CONSTRAINT "reconciliation_report_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_test" ADD CONSTRAINT "contact_test_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_test" ADD CONSTRAINT "contact_test_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_test_attempt" ADD CONSTRAINT "contact_test_attempt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_test_attempt" ADD CONSTRAINT "contact_test_attempt_contact_test_id_fkey" FOREIGN KEY ("contact_test_id") REFERENCES "contact_test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_test_attempt" ADD CONSTRAINT "contact_test_attempt_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — tenant-owned.
ALTER TABLE "distributor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "distributor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "distributor"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "case_distributor_mapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_distributor_mapping" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_distributor_mapping"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "reconciliation_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reconciliation_report"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "contact_test" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_test" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_test"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "contact_test_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_test_attempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_test_attempt"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
