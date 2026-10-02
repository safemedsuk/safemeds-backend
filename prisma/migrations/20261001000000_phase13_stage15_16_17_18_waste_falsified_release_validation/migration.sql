-- QualCloud (Phase 13) Stages 15 (Pharmaceutical Waste Management), 16
-- (Falsified & Substandard Product Handling), 17 (Batch Release / QP),
-- and 18 (Validation / CSV). Purely additive — four new tables, no
-- column drops, no index drops against existing hand-written BRIN/GIN
-- indexes (the generated diff proposed 8 spurious `DROP INDEX`
-- statements against real indexes on audit_entry/product/meddra_term/
-- who_drug_term; stripped per this project's own established
-- discipline before this file was written).

-- CreateTable
CREATE TABLE "waste_disposal_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID,
    "batch_id" UUID,
    "waste_type" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "disposal_method" TEXT NOT NULL,
    "disposal_facility_name" TEXT,
    "disposal_certificate_document_id" UUID,
    "witnessed_by_user_id" UUID,
    "witness_signature_event_id" UUID,
    "witnessed_at" TIMESTAMPTZ(3),
    "disposed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waste_disposal_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable (platform-wide reference catalog — no RLS, mirrors training_type_catalog_entry)
CREATE TABLE "waste_disposal_method_catalog_entry" (
    "id" UUID NOT NULL,
    "method_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waste_disposal_method_catalog_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "falsified_product_report" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID,
    "batch_id" UUID,
    "reported_by" UUID,
    "source" TEXT NOT NULL,
    "evidence_description" TEXT NOT NULL,
    "evidence_document_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authority_notified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "linked_deviation_id" UUID,
    "linked_case_id" UUID,
    "linked_recall_id" UUID,
    "dismissed_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "falsified_product_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_release_decision" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "batch_record_review_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "risk_acceptances" JSONB NOT NULL DEFAULT '[]',
    "signature_event_id" UUID,
    "released_by_user_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_release_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_protocol" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "validation_type" TEXT NOT NULL,
    "approach" TEXT,
    "gamp_category" TEXT,
    "product_id" UUID,
    "equipment_id" UUID,
    "protocol_document_id" UUID NOT NULL,
    "next_revalidation_due_at" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "validation_protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_report" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "execution_records" JSONB,
    "report_document_id" UUID,
    "conclusion" TEXT,
    "executed_by" UUID,
    "executed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "validation_report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waste_disposal_record_company_id_idx" ON "waste_disposal_record"("company_id");
CREATE INDEX "waste_disposal_record_batch_id_idx" ON "waste_disposal_record"("batch_id");
CREATE UNIQUE INDEX "waste_disposal_method_catalog_entry_method_key_key" ON "waste_disposal_method_catalog_entry"("method_key");
CREATE INDEX "falsified_product_report_company_id_idx" ON "falsified_product_report"("company_id");
CREATE INDEX "falsified_product_report_company_id_status_idx" ON "falsified_product_report"("company_id", "status");
CREATE INDEX "batch_release_decision_company_id_idx" ON "batch_release_decision"("company_id");
CREATE INDEX "batch_release_decision_batch_id_idx" ON "batch_release_decision"("batch_id");
CREATE INDEX "validation_protocol_company_id_idx" ON "validation_protocol"("company_id");
CREATE INDEX "validation_protocol_company_id_validation_type_idx" ON "validation_protocol"("company_id", "validation_type");
CREATE INDEX "validation_report_company_id_idx" ON "validation_report"("company_id");
CREATE INDEX "validation_report_protocol_id_idx" ON "validation_report"("protocol_id");

-- AddForeignKey
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_disposal_certificate_document_id_fkey" FOREIGN KEY ("disposal_certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_witnessed_by_user_id_fkey" FOREIGN KEY ("witnessed_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waste_disposal_record" ADD CONSTRAINT "waste_disposal_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "falsified_product_report" ADD CONSTRAINT "falsified_product_report_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "falsified_product_report" ADD CONSTRAINT "falsified_product_report_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "falsified_product_report" ADD CONSTRAINT "falsified_product_report_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "falsified_product_report" ADD CONSTRAINT "falsified_product_report_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "batch_release_decision" ADD CONSTRAINT "batch_release_decision_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_release_decision" ADD CONSTRAINT "batch_release_decision_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "batch_release_decision" ADD CONSTRAINT "batch_release_decision_released_by_user_id_fkey" FOREIGN KEY ("released_by_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "validation_protocol" ADD CONSTRAINT "validation_protocol_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "validation_protocol" ADD CONSTRAINT "validation_protocol_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validation_protocol" ADD CONSTRAINT "validation_protocol_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validation_protocol" ADD CONSTRAINT "validation_protocol_protocol_document_id_fkey" FOREIGN KEY ("protocol_document_id") REFERENCES "sop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "validation_protocol" ADD CONSTRAINT "validation_protocol_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "validation_report" ADD CONSTRAINT "validation_report_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "validation_report" ADD CONSTRAINT "validation_report_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "validation_protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "validation_report" ADD CONSTRAINT "validation_report_report_document_id_fkey" FOREIGN KEY ("report_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validation_report" ADD CONSTRAINT "validation_report_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "validation_report" ADD CONSTRAINT "validation_report_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: tenant tables get FORCE ROW LEVEL SECURITY (waste_disposal_method_catalog_entry
-- is deliberately excluded — it's platform-wide reference data with no company_id,
-- mirroring training_type_catalog_entry's own precedent exactly).
ALTER TABLE "waste_disposal_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_disposal_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waste_disposal_record"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "falsified_product_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "falsified_product_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "falsified_product_report"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "batch_release_decision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_release_decision" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "batch_release_decision"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "validation_protocol" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "validation_protocol" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "validation_protocol"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "validation_report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "validation_report" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "validation_report"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
