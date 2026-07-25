-- CreateEnum
CREATE TYPE "CaseChannel" AS ENUM ('form', 'drug_safety_email', 'hotline_phone', 'post', 'whatsapp_qr', 'public_url', 'hcp_direct', 'literature', 'clinical_study');

-- CreateEnum
CREATE TYPE "ReporterType" AS ENUM ('consumer', 'healthcare_professional');

-- CreateEnum
CREATE TYPE "PatientSex" AS ENUM ('male', 'female', 'unknown');

-- CreateEnum
CREATE TYPE "DrugCharacterization" AS ENUM ('suspect', 'concomitant', 'interacting');

-- CreateEnum
CREATE TYPE "ReactionOutcome" AS ENUM ('recovered', 'recovering', 'not_recovered', 'recovered_with_sequelae', 'fatal', 'unknown');

-- CreateEnum
CREATE TYPE "WhoUmcCausality" AS ENUM ('certain', 'probable_likely', 'possible', 'unlikely', 'conditional_unclassified', 'unassessable_unclassifiable');

-- NOTE: Prisma's drift detection proposes dropping the hand-written raw-SQL
-- BRIN index on audit_entry.occurred_at and the gin_trgm_ops trigram indexes
-- on product/meddra_term, since they weren't created via a tracked
-- `CREATE INDEX` in a way Prisma's introspection recognizes as matching the
-- schema. These are NOT schema drift — they're deliberate, hand-added
-- indexes (see the migrations that created them) and must never be dropped.
-- The generated DROP INDEX statements have been removed from this file.

-- CreateTable
CREATE TABLE "pv_case" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "report_type_id" UUID NOT NULL,
    "country_of_occurrence_id" UUID NOT NULL,
    "country_of_report_id" UUID NOT NULL,
    "channel" "CaseChannel" NOT NULL DEFAULT 'form',
    "awareness_date" DATE NOT NULL,
    "received_date" DATE NOT NULL,
    "additional_information_encrypted" TEXT,
    "duplicate_of_case_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'intake',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pv_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_reporter" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "reporter_type" "ReporterType" NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "qualification" TEXT,
    "country_id" UUID,
    "organization" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_reporter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_patient" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "initials" TEXT,
    "date_of_birth" DATE,
    "age_years" INTEGER,
    "sex" "PatientSex" NOT NULL DEFAULT 'unknown',
    "weight_kg" DOUBLE PRECISION,
    "height_cm" DOUBLE PRECISION,
    "medical_history_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_suspect_product" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "drug_characterization" "DrugCharacterization" NOT NULL,
    "medicinal_product" TEXT NOT NULL,
    "active_substance_name" TEXT,
    "atc_code" TEXT,
    "dosage_form" TEXT,
    "route" TEXT,
    "dose_text" TEXT,
    "batch_number" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "action_taken" TEXT,
    "obtained_country_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_suspect_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_adverse_event" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "meddra_term_id" UUID,
    "reported_term" TEXT NOT NULL,
    "narrative_encrypted" TEXT NOT NULL,
    "onset_date" DATE,
    "resolution_date" DATE,
    "outcome" "ReactionOutcome" NOT NULL DEFAULT 'unknown',
    "seriousness_death" BOOLEAN NOT NULL DEFAULT false,
    "seriousness_life_threatening" BOOLEAN NOT NULL DEFAULT false,
    "seriousness_hospitalization" BOOLEAN NOT NULL DEFAULT false,
    "seriousness_disabling" BOOLEAN NOT NULL DEFAULT false,
    "seriousness_congenital_anomaly" BOOLEAN NOT NULL DEFAULT false,
    "seriousness_other" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_adverse_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_causality_assessment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "suspect_product_id" UUID NOT NULL,
    "adverse_event_id" UUID NOT NULL,
    "who_umc_category" "WhoUmcCausality",
    "naranjo_score" INTEGER,
    "naranjo_answers" JSONB,
    "assessed_by" UUID,
    "assessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_causality_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pv_source_document" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "redaction_applied" BOOLEAN NOT NULL DEFAULT false,
    "redacted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_source_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pv_case_company_id_status_idx" ON "pv_case"("company_id", "status");

-- CreateIndex
CREATE INDEX "pv_case_company_id_created_at_idx" ON "pv_case"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "pv_case_company_id_created_by_idx" ON "pv_case"("company_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "pv_case_company_id_reference_number_key" ON "pv_case"("company_id", "reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "pv_reporter_case_id_key" ON "pv_reporter"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "pv_patient_case_id_key" ON "pv_patient"("case_id");

-- CreateIndex
CREATE INDEX "pv_suspect_product_company_id_case_id_idx" ON "pv_suspect_product"("company_id", "case_id");

-- CreateIndex
CREATE INDEX "pv_adverse_event_company_id_case_id_idx" ON "pv_adverse_event"("company_id", "case_id");

-- CreateIndex
CREATE INDEX "pv_causality_assessment_company_id_case_id_idx" ON "pv_causality_assessment"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "pv_causality_assessment_suspect_product_id_adverse_event_id_key" ON "pv_causality_assessment"("suspect_product_id", "adverse_event_id");

-- CreateIndex
CREATE INDEX "pv_source_document_company_id_case_id_idx" ON "pv_source_document"("company_id", "case_id");

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_report_type_id_fkey" FOREIGN KEY ("report_type_id") REFERENCES "report_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_country_of_occurrence_id_fkey" FOREIGN KEY ("country_of_occurrence_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_country_of_report_id_fkey" FOREIGN KEY ("country_of_report_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_duplicate_of_case_id_fkey" FOREIGN KEY ("duplicate_of_case_id") REFERENCES "pv_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_reporter" ADD CONSTRAINT "pv_reporter_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_reporter" ADD CONSTRAINT "pv_reporter_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_reporter" ADD CONSTRAINT "pv_reporter_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_patient" ADD CONSTRAINT "pv_patient_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_patient" ADD CONSTRAINT "pv_patient_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_obtained_country_id_fkey" FOREIGN KEY ("obtained_country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_adverse_event" ADD CONSTRAINT "pv_adverse_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_adverse_event" ADD CONSTRAINT "pv_adverse_event_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_adverse_event" ADD CONSTRAINT "pv_adverse_event_meddra_term_id_fkey" FOREIGN KEY ("meddra_term_id") REFERENCES "meddra_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_causality_assessment" ADD CONSTRAINT "pv_causality_assessment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_causality_assessment" ADD CONSTRAINT "pv_causality_assessment_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_causality_assessment" ADD CONSTRAINT "pv_causality_assessment_suspect_product_id_fkey" FOREIGN KEY ("suspect_product_id") REFERENCES "pv_suspect_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_causality_assessment" ADD CONSTRAINT "pv_causality_assessment_adverse_event_id_fkey" FOREIGN KEY ("adverse_event_id") REFERENCES "pv_adverse_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_causality_assessment" ADD CONSTRAINT "pv_causality_assessment_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_source_document" ADD CONSTRAINT "pv_source_document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_source_document" ADD CONSTRAINT "pv_source_document_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_source_document" ADD CONSTRAINT "pv_source_document_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_source_document" ADD CONSTRAINT "pv_source_document_redacted_by_fkey" FOREIGN KEY ("redacted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — every Stage 1 table is tenant-owned.
ALTER TABLE "pv_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_case"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_reporter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_reporter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_reporter"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_patient" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_patient"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_suspect_product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_suspect_product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_suspect_product"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_adverse_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_adverse_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_adverse_event"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_causality_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_causality_assessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_causality_assessment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pv_source_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_source_document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_source_document"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
