-- VigiCloud Phase 11, Stage 18 — Reporting & Periodic Outputs.
-- Adds: Product.international_birth_date (EURD-cadence anchor for
-- PSUR/PBRER), risk_management_plan (version-on-write, per product),
-- safety_alert (the manual half of safety-signal notifications),
-- safety_letter_recipient (DHCP/DIL letter dispatch tracking).
-- Dashboards, line listings, and PSUR/PBRER/DSUR/PADER/CIOMS-II periodic
-- reports need no new tables — they read existing case/AE data live and
-- reuse Stage 0.10's `GeneratedReport` primitive exactly as its own doc
-- comment anticipated.
--
-- Generated via `prisma migrate diff` against the shadow database, then
-- hand-edited: the 8 known-false-positive `DROP INDEX` statements for
-- `audit_entry_occurred_at_brin_idx` and the 7 pg_trgm indexes (created via
-- raw SQL in earlier migrations, invisible to Prisma's own introspection,
-- and NOT touched here) were stripped, exactly like every prior stage's
-- migration in this repo. RLS ENABLE/FORCE/CREATE POLICY blocks are
-- appended by hand for all three new tenant-owned tables.

-- CreateEnum
CREATE TYPE "RiskManagementPlanStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "SafetyAlertStatus" AS ENUM ('open', 'reviewed', 'actioned', 'dismissed');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "international_birth_date" DATE;

-- CreateTable
CREATE TABLE "risk_management_plan" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RiskManagementPlanStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "document_id" UUID,
    "next_renewal_due_at" DATE,
    "submitted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "risk_management_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_alert" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "summary" TEXT NOT NULL,
    "affected_product_id" UUID,
    "status" "SafetyAlertStatus" NOT NULL DEFAULT 'open',
    "review_note" TEXT,
    "logged_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "safety_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_letter_recipient" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "generated_report_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_letter_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_management_plan_company_id_status_idx" ON "risk_management_plan"("company_id", "status");

-- CreateIndex
CREATE INDEX "risk_management_plan_company_id_next_renewal_due_at_idx" ON "risk_management_plan"("company_id", "next_renewal_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_management_plan_product_id_version_key" ON "risk_management_plan"("product_id", "version");

-- CreateIndex
CREATE INDEX "safety_alert_company_id_status_idx" ON "safety_alert"("company_id", "status");

-- CreateIndex
CREATE INDEX "safety_alert_company_id_created_at_idx" ON "safety_alert"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "safety_letter_recipient_company_id_generated_report_id_idx" ON "safety_letter_recipient"("company_id", "generated_report_id");

-- AddForeignKey
ALTER TABLE "risk_management_plan" ADD CONSTRAINT "risk_management_plan_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_management_plan" ADD CONSTRAINT "risk_management_plan_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_management_plan" ADD CONSTRAINT "risk_management_plan_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_management_plan" ADD CONSTRAINT "risk_management_plan_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alert" ADD CONSTRAINT "safety_alert_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alert" ADD CONSTRAINT "safety_alert_affected_product_id_fkey" FOREIGN KEY ("affected_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_alert" ADD CONSTRAINT "safety_alert_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_letter_recipient" ADD CONSTRAINT "safety_letter_recipient_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_letter_recipient" ADD CONSTRAINT "safety_letter_recipient_generated_report_id_fkey" FOREIGN KEY ("generated_report_id") REFERENCES "generated_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — tenant-owned.
ALTER TABLE "risk_management_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_management_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "risk_management_plan"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "safety_alert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_alert" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_alert"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "safety_letter_recipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_letter_recipient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "safety_letter_recipient"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
