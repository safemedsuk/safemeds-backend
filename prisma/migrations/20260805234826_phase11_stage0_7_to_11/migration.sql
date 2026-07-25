-- VigiCloud Phase 11, Stage 0.7-0.11:
--   0.7  SecurityPolicy default session timeout 30 -> 5 minutes
--   0.8  UserLocationScope (org-structure permission scoping)
--   0.10 ReportType.moduleKey + the generic GeneratedReport primitive
--   0.11 ReportingRule.reportingPeriodDays
--
-- NOTE: `prisma migrate dev --create-only` also proposed 5 `DROP INDEX`
-- statements against hand-written raw-SQL indexes (BRIN on audit_entry,
-- trigram on product/meddra_term) that have no `@@index` representation
-- in schema.prisma — same drift-detection false positive documented in
-- the phase11_stage0_base_primitives migration. Removed entirely here
-- too; they must never be dropped.

-- CreateEnum
CREATE TYPE "LocationScopeLevel" AS ENUM ('market', 'facility');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'final', 'submitted');

-- AlterTable
ALTER TABLE "report_type" ADD COLUMN     "module_key" TEXT NOT NULL DEFAULT 'pv';

-- AlterTable
ALTER TABLE "reporting_rule" ADD COLUMN     "reporting_period_days" INTEGER;

-- AlterTable
ALTER TABLE "security_policy" ALTER COLUMN "session_timeout_minutes" SET DEFAULT 5;

-- Data backfill: only rows still sitting on the never-touched old default
-- move to the new one — a company that explicitly customized this value
-- (via PATCH /company/security-policy) keeps its own chosen value.
UPDATE "security_policy" SET "session_timeout_minutes" = 5 WHERE "session_timeout_minutes" = 30;

-- CreateTable
CREATE TABLE "user_location_scope" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "level" "LocationScopeLevel" NOT NULL,
    "country_id" UUID,
    "facility_id" UUID,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_report" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "report_type_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "record_type" TEXT,
    "record_id" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "due_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "generated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_location_scope_company_id_user_id_idx" ON "user_location_scope"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "generated_report_company_id_module_key_report_type_key_idx" ON "generated_report"("company_id", "module_key", "report_type_key");

-- CreateIndex
CREATE INDEX "generated_report_company_id_status_idx" ON "generated_report"("company_id", "status");

-- CreateIndex
CREATE INDEX "generated_report_company_id_due_at_idx" ON "generated_report"("company_id", "due_at");

-- AddForeignKey
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_scope" ADD CONSTRAINT "user_location_scope_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — same tenant_isolation template as every other
-- tenant-owned table (phase2_3_rls_tenant_isolation onward). Both new
-- tables are genuinely tenant-owned (companyId required, never null).

ALTER TABLE "user_location_scope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_location_scope" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_location_scope"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "generated_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "generated_report"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
