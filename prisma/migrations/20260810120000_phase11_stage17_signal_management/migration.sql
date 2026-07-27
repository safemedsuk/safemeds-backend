-- VigiCloud Phase 11, Stage 17 — Signal Management.
-- Adds: pv_signal (the signal record + all lifecycle-stage domain data),
-- pv_signal_case (the linked-case evidence join table).
--
-- Generated via `prisma migrate diff` against the shadow database, then
-- hand-edited: the 8 known-false-positive `DROP INDEX` statements for
-- `audit_entry_occurred_at_brin_idx` and the 7 pg_trgm indexes (created via
-- raw SQL in earlier migrations, invisible to Prisma's own introspection,
-- and NOT touched here) were stripped, exactly like every prior stage's
-- migration in this repo. RLS ENABLE/FORCE/CREATE POLICY blocks are
-- appended by hand for both new tenant-owned tables.

-- CreateEnum
CREATE TYPE "SignalRecommendationAction" AS ENUM ('request_more_data', 'propose_product_info_update', 'request_rmp_update', 'propose_risk_minimisation', 'sponsor_followup_study', 'no_action');

-- CreateTable
CREATE TABLE "pv_signal" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'detected',
    "detection_method" TEXT NOT NULL DEFAULT 'pattern_flag',
    "product_identifier" TEXT NOT NULL,
    "batch_number" TEXT,
    "previous_awareness" BOOLEAN,
    "previous_awareness_note" TEXT,
    "strength_of_evidence_case_count" INTEGER,
    "clinical_relevance_note" TEXT,
    "severity_note" TEXT,
    "patient_exposure_note" TEXT,
    "expected_regulatory_response_note" TEXT,
    "assessment_note" TEXT,
    "recommendation_action" "SignalRecommendationAction",
    "recommendation_note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pv_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_signal_case" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_signal_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pv_signal_company_id_status_idx" ON "pv_signal"("company_id", "status");

-- CreateIndex
CREATE INDEX "pv_signal_case_company_id_case_id_idx" ON "pv_signal_case"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "pv_signal_case_signal_id_case_id_key" ON "pv_signal_case"("signal_id", "case_id");

-- AddForeignKey
ALTER TABLE "pv_signal" ADD CONSTRAINT "pv_signal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_signal" ADD CONSTRAINT "pv_signal_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_signal_case" ADD CONSTRAINT "pv_signal_case_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_signal_case" ADD CONSTRAINT "pv_signal_case_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "pv_signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_signal_case" ADD CONSTRAINT "pv_signal_case_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — tenant-owned.
ALTER TABLE "pv_signal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_signal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_signal"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "pv_signal_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_signal_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_signal_case"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
