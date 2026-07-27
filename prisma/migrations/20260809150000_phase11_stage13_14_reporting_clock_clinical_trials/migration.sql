-- VigiCloud Phase 11 Stage 13 (Per-Country Reporting Clock, Finalized) +
-- Stage 14 (Clinical-Trial SAE Intake).
--
-- Stage 13: `ReportingRule.submissionDestination` (plain string, default
-- 'regulator', matching `seriousnessClass`'s own precedent) — the one
-- schema change Stage 13 itself calls for, since the deadline-resolution
-- mechanism (`RuleResolutionService`) needs no other change: a
-- structurally different destination (Ethics Committee/clinical-trial
-- portal, never PPB) is modeled as its own `RegulatoryAuthority` row
-- (seeded in country-rules.seed-data.ts, not this migration), reusing
-- the exact same authority/reportType/seriousnessClass resolution query
-- unchanged.
--
-- Stage 14: `clinical_trial` + `clinical_trial_subject` (new tenant
-- tables, RLS forced below like every other tenant table) plus
-- `pv_case.clinical_trial_id`/`clinical_trial_subject_id` (nullable —
-- only meaningful when `Case.channel = 'clinical_study'`). Subjects are
-- identified only by a blinded `subject_code`, never a name, matching
-- `Patient.initials`'s own "never a full name" discipline;
-- `treatment_arm_encrypted` is the sponsor-provided randomization
-- assignment, encrypted at rest like every other free-text field, only
-- ever decrypted by the signature-gated reveal action.
--
-- The 8 DropIndex statements `prisma migrate diff` also proposed here
-- (the BRIN index + 7 pg_trgm indexes) are hand-stripped as the known
-- false positives documented in CLAUDE.md's migration workflow —
-- Prisma's diffing doesn't recognize indexes created via raw SQL in
-- earlier migrations, not a real schema change.

-- CreateEnum
CREATE TYPE "ClinicalTrialBlindingType" AS ENUM ('open_label', 'single_blind', 'double_blind');

-- CreateEnum
CREATE TYPE "ClinicalTrialStatus" AS ENUM ('active', 'completed', 'terminated');

-- CreateEnum
CREATE TYPE "ClinicalTrialSubjectStatus" AS ENUM ('enrolled', 'withdrawn', 'completed');

-- AlterTable
ALTER TABLE "pv_case" ADD COLUMN     "clinical_trial_id" UUID,
ADD COLUMN     "clinical_trial_subject_id" UUID;

-- AlterTable
ALTER TABLE "reporting_rule" ADD COLUMN     "submission_destination" TEXT NOT NULL DEFAULT 'regulator';

-- CreateTable
CREATE TABLE "clinical_trial" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "trial_reference" TEXT NOT NULL,
    "trial_name" TEXT NOT NULL,
    "sponsor" TEXT,
    "phase" TEXT,
    "blinding_type" "ClinicalTrialBlindingType" NOT NULL DEFAULT 'open_label',
    "ethics_committee_name" TEXT,
    "ethics_committee_contact_email" TEXT,
    "clinical_trial_portal_reference" TEXT,
    "country_id" UUID NOT NULL,
    "status" "ClinicalTrialStatus" NOT NULL DEFAULT 'active',
    "start_date" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinical_trial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_trial_subject" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "clinical_trial_id" UUID NOT NULL,
    "subject_code" TEXT NOT NULL,
    "sex" "PatientSex" NOT NULL DEFAULT 'unknown',
    "age_years" INTEGER,
    "enrolled_at" DATE NOT NULL,
    "status" "ClinicalTrialSubjectStatus" NOT NULL DEFAULT 'enrolled',
    "treatment_arm_encrypted" TEXT,
    "blinding_broken" BOOLEAN NOT NULL DEFAULT false,
    "unblinded_by" UUID,
    "unblinded_at" TIMESTAMPTZ(3),
    "unblinding_reason_encrypted" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinical_trial_subject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinical_trial_company_id_status_idx" ON "clinical_trial"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_trial_company_id_trial_reference_key" ON "clinical_trial"("company_id", "trial_reference");

-- CreateIndex
CREATE INDEX "clinical_trial_subject_company_id_clinical_trial_id_idx" ON "clinical_trial_subject"("company_id", "clinical_trial_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_trial_subject_clinical_trial_id_subject_code_key" ON "clinical_trial_subject"("clinical_trial_id", "subject_code");

-- CreateIndex
CREATE INDEX "pv_case_company_id_clinical_trial_id_idx" ON "pv_case"("company_id", "clinical_trial_id");

-- AddForeignKey
ALTER TABLE "clinical_trial" ADD CONSTRAINT "clinical_trial_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trial" ADD CONSTRAINT "clinical_trial_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trial_subject" ADD CONSTRAINT "clinical_trial_subject_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trial_subject" ADD CONSTRAINT "clinical_trial_subject_clinical_trial_id_fkey" FOREIGN KEY ("clinical_trial_id") REFERENCES "clinical_trial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trial_subject" ADD CONSTRAINT "clinical_trial_subject_unblinded_by_fkey" FOREIGN KEY ("unblinded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_clinical_trial_id_fkey" FOREIGN KEY ("clinical_trial_id") REFERENCES "clinical_trial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_clinical_trial_subject_id_fkey" FOREIGN KEY ("clinical_trial_subject_id") REFERENCES "clinical_trial_subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — both new Stage 14 tables are tenant-owned.
ALTER TABLE "clinical_trial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_trial" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinical_trial"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "clinical_trial_subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_trial_subject" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinical_trial_subject"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
