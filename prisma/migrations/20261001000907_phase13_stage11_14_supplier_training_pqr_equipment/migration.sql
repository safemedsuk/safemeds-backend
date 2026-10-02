-- NOTE: Prisma's own `migrate dev --create-only` proposed 8 spurious
-- `DROP INDEX` statements here against real, load-bearing hand-written
-- indexes (the audit_entry BRIN index + 7 pg_trgm GIN indexes) that have
-- zero relationship to this migration's actual schema change — they
-- exist via raw SQL in earlier migrations with no `@@index` equivalent
-- in schema.prisma, so Prisma's diff engine proposes deleting what it
-- can't see declared. Stripped per CLAUDE.md's own documented gotcha
-- (confirmed real via `psql \di` before stripping, same discipline as
-- every prior migration that hit this).

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "supplier_critical_requalification_months" INTEGER,
ADD COLUMN     "supplier_non_critical_requalification_months" INTEGER;

-- AlterTable
ALTER TABLE "supplier" ADD COLUMN     "last_qualified_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_requalification_due_at" TIMESTAMPTZ(3),
ADD COLUMN     "performance_flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "pqr" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "assembled_data" JSONB,
    "conclusions_narrative" TEXT,
    "trends_narrative" TEXT,
    "recommended_actions" JSONB,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "next_review_due_at" TIMESTAMPTZ(3),
    "generated_report_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pqr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_training_curriculum" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "training_type_id" UUID NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "recertification_interval_months" INTEGER,
    "document_type_trigger" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_training_curriculum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_assessment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "training_record_id" UUID NOT NULL,
    "assessment_method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "notes" TEXT,
    "assessed_by" UUID,
    "assessed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competency_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_questionnaire" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "overall_score" INTEGER,
    "assessed_by" UUID,
    "assessed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_of_analysis" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "material_specification_id" UUID NOT NULL,
    "batch_or_lot_number" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'quarantined',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificate_of_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_qualification_event" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "protocol_document_id" UUID,
    "report_document_id" UUID,
    "result" TEXT NOT NULL DEFAULT 'pass',
    "notes" TEXT,
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_qualification_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "maintenance_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "performed_by" UUID,
    "next_due_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pqr_company_id_product_id_idx" ON "pqr"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "pqr_company_id_status_idx" ON "pqr"("company_id", "status");

-- CreateIndex
CREATE INDEX "role_training_curriculum_company_id_document_type_trigger_idx" ON "role_training_curriculum"("company_id", "document_type_trigger");

-- CreateIndex
CREATE UNIQUE INDEX "role_training_curriculum_company_id_role_key_training_type__key" ON "role_training_curriculum"("company_id", "role_key", "training_type_id");

-- CreateIndex
CREATE INDEX "competency_assessment_company_id_training_record_id_idx" ON "competency_assessment"("company_id", "training_record_id");

-- CreateIndex
CREATE INDEX "supplier_questionnaire_company_id_supplier_id_idx" ON "supplier_questionnaire"("company_id", "supplier_id");

-- CreateIndex
CREATE INDEX "certificate_of_analysis_company_id_supplier_id_idx" ON "certificate_of_analysis"("company_id", "supplier_id");

-- CreateIndex
CREATE INDEX "certificate_of_analysis_company_id_material_specification_i_idx" ON "certificate_of_analysis"("company_id", "material_specification_id");

-- CreateIndex
CREATE INDEX "equipment_qualification_event_company_id_equipment_id_idx" ON "equipment_qualification_event"("company_id", "equipment_id");

-- CreateIndex
CREATE INDEX "maintenance_record_company_id_equipment_id_idx" ON "maintenance_record"("company_id", "equipment_id");

-- CreateIndex
CREATE INDEX "equipment_company_id_calibration_due_at_idx" ON "equipment"("company_id", "calibration_due_at");

-- CreateIndex
CREATE INDEX "supplier_company_id_next_requalification_due_at_idx" ON "supplier"("company_id", "next_requalification_due_at");

-- AddForeignKey
ALTER TABLE "pqr" ADD CONSTRAINT "pqr_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pqr" ADD CONSTRAINT "pqr_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pqr" ADD CONSTRAINT "pqr_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pqr" ADD CONSTRAINT "pqr_generated_report_id_fkey" FOREIGN KEY ("generated_report_id") REFERENCES "generated_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pqr" ADD CONSTRAINT "pqr_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_training_curriculum" ADD CONSTRAINT "role_training_curriculum_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_training_curriculum" ADD CONSTRAINT "role_training_curriculum_training_type_id_fkey" FOREIGN KEY ("training_type_id") REFERENCES "training_type_catalog_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_training_curriculum" ADD CONSTRAINT "role_training_curriculum_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_assessment" ADD CONSTRAINT "competency_assessment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_assessment" ADD CONSTRAINT "competency_assessment_training_record_id_fkey" FOREIGN KEY ("training_record_id") REFERENCES "training_record"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_assessment" ADD CONSTRAINT "competency_assessment_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_questionnaire" ADD CONSTRAINT "supplier_questionnaire_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_questionnaire" ADD CONSTRAINT "supplier_questionnaire_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_questionnaire" ADD CONSTRAINT "supplier_questionnaire_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_of_analysis" ADD CONSTRAINT "certificate_of_analysis_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_of_analysis" ADD CONSTRAINT "certificate_of_analysis_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_of_analysis" ADD CONSTRAINT "certificate_of_analysis_material_specification_id_fkey" FOREIGN KEY ("material_specification_id") REFERENCES "specification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_of_analysis" ADD CONSTRAINT "certificate_of_analysis_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_of_analysis" ADD CONSTRAINT "certificate_of_analysis_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_qualification_event" ADD CONSTRAINT "equipment_qualification_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_qualification_event" ADD CONSTRAINT "equipment_qualification_event_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_qualification_event" ADD CONSTRAINT "equipment_qualification_event_protocol_document_id_fkey" FOREIGN KEY ("protocol_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_qualification_event" ADD CONSTRAINT "equipment_qualification_event_report_document_id_fkey" FOREIGN KEY ("report_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_qualification_event" ADD CONSTRAINT "equipment_qualification_event_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_record" ADD CONSTRAINT "maintenance_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — every new tenant table, in this same migration
-- (never retrofitted), matching this codebase's own established
-- discipline exactly (see Stage 0's own foundation migration).

ALTER TABLE "pqr" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pqr" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pqr"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "role_training_curriculum" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_training_curriculum" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_training_curriculum"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "competency_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competency_assessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "competency_assessment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "supplier_questionnaire" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_questionnaire" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_questionnaire"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "certificate_of_analysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificate_of_analysis" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "certificate_of_analysis"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "equipment_qualification_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_qualification_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_qualification_event"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "maintenance_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenance_record"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
