-- AlterTable
ALTER TABLE "company" ADD COLUMN     "quality_trend_threshold_count" INTEGER,
ADD COLUMN     "quality_trend_window_days" INTEGER;

-- AlterTable
ALTER TABLE "internal_audit" ADD COLUMN     "audit_scope" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "inspection_checklist_template" (
    "id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "section_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mapped_record_type" TEXT,
    "guideline_reference" TEXT,
    "unverified" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspection_checklist_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_audit_checklist_response" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "checklist_template_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_reviewed',
    "observations" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "internal_audit_checklist_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_inspection_response" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "finding_id" UUID,
    "response_due_date" DATE,
    "response_text" TEXT,
    "evidence_document_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regulatory_inspection_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_trend_flag" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "root_cause_category" TEXT NOT NULL,
    "occurrence_count" INTEGER NOT NULL,
    "capa_ids" TEXT[],
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quality_trend_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_review" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "review_date" DATE NOT NULL,
    "attendees" TEXT,
    "metrics_snapshot" JSONB NOT NULL,
    "recurring_issue_flags_snapshot" JSONB,
    "actions_agreed" JSONB,
    "next_review_due_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "management_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inspection_checklist_template_authority_id_section_key_key" ON "inspection_checklist_template"("authority_id", "section_key");

-- CreateIndex
CREATE UNIQUE INDEX "internal_audit_checklist_response_audit_id_checklist_templa_key" ON "internal_audit_checklist_response"("audit_id", "checklist_template_id");

-- CreateIndex
CREATE INDEX "regulatory_inspection_response_company_id_audit_id_idx" ON "regulatory_inspection_response"("company_id", "audit_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_trend_flag_company_id_root_cause_category_key" ON "quality_trend_flag"("company_id", "root_cause_category");

-- CreateIndex
CREATE INDEX "management_review_company_id_review_date_idx" ON "management_review"("company_id", "review_date");

-- AddForeignKey
ALTER TABLE "internal_audit" ADD CONSTRAINT "internal_audit_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_checklist_template" ADD CONSTRAINT "inspection_checklist_template_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_checklist_response" ADD CONSTRAINT "internal_audit_checklist_response_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_checklist_response" ADD CONSTRAINT "internal_audit_checklist_response_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "internal_audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_checklist_response" ADD CONSTRAINT "internal_audit_checklist_response_checklist_template_id_fkey" FOREIGN KEY ("checklist_template_id") REFERENCES "inspection_checklist_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_checklist_response" ADD CONSTRAINT "internal_audit_checklist_response_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "internal_audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "audit_finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspection_response" ADD CONSTRAINT "regulatory_inspection_response_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_trend_flag" ADD CONSTRAINT "quality_trend_flag_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_trend_flag" ADD CONSTRAINT "quality_trend_flag_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_review" ADD CONSTRAINT "management_review_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_review" ADD CONSTRAINT "management_review_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS
-- `inspection_checklist_template` deliberately has NO row-level security —
-- it is platform-wide reference/config data scoped by authorityId, not by
-- tenant, matching `AuditRequirementDefinition`'s own exact precedent
-- (VigiCloud Stage 16.2), which also carries no RLS for the same reason.

ALTER TABLE "internal_audit_checklist_response" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_audit_checklist_response" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "internal_audit_checklist_response"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "regulatory_inspection_response" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_inspection_response" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_inspection_response"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "quality_trend_flag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quality_trend_flag" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quality_trend_flag"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "management_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "management_review"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
