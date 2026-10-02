-- AlterEnum
ALTER TYPE "CaseChannel" ADD VALUE 'quality_complaint_routed';

-- AlterTable
ALTER TABLE "batch" ADD COLUMN     "batch_size" TEXT,
ADD COLUMN     "manufacturing_site_id" UUID,
ADD COLUMN     "parent_batch_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quality_status" TEXT NOT NULL DEFAULT 'quarantine',
ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "change_control" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "change_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "change_description_encrypted" TEXT,
    "scope" TEXT NOT NULL,
    "product_id" UUID,
    "batch_id" UUID,
    "equipment_id" UUID,
    "supplier_id" UUID,
    "sop_id" UUID,
    "impact_assessment" JSONB,
    "cross_functional_approvals" JSONB NOT NULL DEFAULT '[]',
    "affected_product_registration_id" UUID,
    "linked_reg_variation_id" UUID,
    "implementation_record" TEXT,
    "verification_result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "change_control_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "complaint_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "reporter_name" TEXT,
    "reporter_contact" TEXT,
    "channel" TEXT NOT NULL,
    "description_encrypted" TEXT NOT NULL,
    "classification" TEXT,
    "severity" TEXT,
    "resolution_note_encrypted" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "capa_id" UUID,
    "routed_case_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'intake',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oos" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "oos_number" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "specification_id" UUID NOT NULL,
    "parameter_id" UUID NOT NULL,
    "test_result" TEXT NOT NULL,
    "investigation_phase" TEXT NOT NULL DEFAULT 'phase_1_lab_investigation',
    "phase1_assignable_cause_found" BOOLEAN,
    "phase1_findings" TEXT,
    "retest_authorized" BOOLEAN,
    "retest_rationale" TEXT,
    "phase2_triggered" BOOLEAN NOT NULL DEFAULT false,
    "phase2_findings" TEXT,
    "batch_impact" TEXT,
    "capa_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'phase_1_lab_investigation',
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_record_review" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "mbr_document_id" UUID,
    "reviewer_user_id" UUID NOT NULL,
    "review_findings" TEXT,
    "disposition" TEXT,
    "dispositioned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "batch_record_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_control_linked_reg_variation_id_key" ON "change_control"("linked_reg_variation_id");

-- CreateIndex
CREATE INDEX "change_control_company_id_status_idx" ON "change_control"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_control_company_id_change_number_key" ON "change_control"("company_id", "change_number");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_routed_case_id_key" ON "complaint"("routed_case_id");

-- CreateIndex
CREATE INDEX "complaint_company_id_status_idx" ON "complaint"("company_id", "status");

-- CreateIndex
CREATE INDEX "complaint_company_id_created_at_idx" ON "complaint"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "complaint_company_id_complaint_number_key" ON "complaint"("company_id", "complaint_number");

-- CreateIndex
CREATE INDEX "oos_company_id_status_idx" ON "oos"("company_id", "status");

-- CreateIndex
CREATE INDEX "oos_company_id_batch_id_idx" ON "oos"("company_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "oos_company_id_oos_number_key" ON "oos"("company_id", "oos_number");

-- CreateIndex
CREATE INDEX "batch_record_review_company_id_idx" ON "batch_record_review"("company_id");

-- CreateIndex
CREATE INDEX "batch_record_review_batch_id_idx" ON "batch_record_review"("batch_id");

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_manufacturing_site_id_fkey" FOREIGN KEY ("manufacturing_site_id") REFERENCES "manufacturing_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_affected_product_registration_id_fkey" FOREIGN KEY ("affected_product_registration_id") REFERENCES "product_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_linked_reg_variation_id_fkey" FOREIGN KEY ("linked_reg_variation_id") REFERENCES "reg_variation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control" ADD CONSTRAINT "change_control_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_capa_id_fkey" FOREIGN KEY ("capa_id") REFERENCES "capa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_routed_case_id_fkey" FOREIGN KEY ("routed_case_id") REFERENCES "pv_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "specification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "specification_parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_capa_id_fkey" FOREIGN KEY ("capa_id") REFERENCES "capa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oos" ADD CONSTRAINT "oos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_record_review" ADD CONSTRAINT "batch_record_review_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_record_review" ADD CONSTRAINT "batch_record_review_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_record_review" ADD CONSTRAINT "batch_record_review_mbr_document_id_fkey" FOREIGN KEY ("mbr_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_record_review" ADD CONSTRAINT "batch_record_review_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — all four new tenant tables, in this same migration.

ALTER TABLE "change_control" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_control" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "change_control"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "complaint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "complaint" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "complaint"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "oos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "oos"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "batch_record_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_record_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "batch_record_review"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
