-- AlterTable
ALTER TABLE "recall" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "level" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'real',
ADD COLUMN     "opened_at" TIMESTAMPTZ(3),
ADD COLUMN     "reason_category" TEXT,
ADD COLUMN     "ref" TEXT,
ADD COLUMN     "trigger_source_id" UUID,
ADD COLUMN     "trigger_source_type" TEXT,
ADD COLUMN     "type" TEXT;

-- CreateTable
CREATE TABLE "recall_rule_set" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "regulatory_authority_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signed_off_by" UUID,
    "signed_off_at" TIMESTAMPTZ(3),
    "effective_date" DATE,
    "next_review_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_rule_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_rule" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "requirement_text" TEXT NOT NULL,
    "applies_when_class" TEXT,
    "applies_when_level" TEXT,
    "applies_when_type" TEXT,
    "anchor_event" TEXT NOT NULL,
    "offset" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'days',
    "day_basis" TEXT NOT NULL DEFAULT 'calendar',
    "owner_role_key" TEXT NOT NULL,
    "evidence_types" TEXT[],
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "blocks_closure" BOOLEAN NOT NULL DEFAULT false,
    "submission_template_id" UUID,
    "source_doc" TEXT NOT NULL,
    "source_instrument" TEXT,
    "source_section" TEXT,
    "source_url" TEXT,
    "unverified" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_submission_template" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_submission_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_submission" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_country_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "template_version" INTEGER NOT NULL,
    "document_id" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submitted_proof_document_id" UUID,
    "generated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_country" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "regulatory_authority_id" UUID,
    "rule_set_id" UUID,
    "rule_set_version" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "class" TEXT,
    "level" TEXT,
    "regulator_decision" TEXT,
    "regulator_approval_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_requirement" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_country_id" UUID NOT NULL,
    "recall_rule_id" UUID NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "owner_role_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "evidence_ids" TEXT[],
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_scope_version" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_scope_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_scope_item" (
    "id" UUID NOT NULL,
    "scope_version_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "batch_size" INTEGER,
    "quantity_distributed" INTEGER,
    "quantity_held_by_mah" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_scope_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stakeholder" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "org_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "country" TEXT,
    "licence_no" TEXT,
    "licence_status" TEXT,
    "parent_id" UUID,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "contact_whatsapp" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stakeholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_distribution_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "from_org_id" UUID,
    "to_org_id" UUID NOT NULL,
    "qty_packs" INTEGER,
    "qty_units" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "import_job_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_distribution_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_import_job" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "document_id" UUID,
    "source_org_id" UUID,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "mapping" JSONB,
    "errors" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_cascade_invite" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "stakeholder_id" UUID NOT NULL,
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'awaiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_cascade_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_sighting" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "country" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidence_document_id" UUID,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_sighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_portal_link" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "stakeholder_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_portal_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_portal_action" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "client_timestamp" TIMESTAMPTZ(3),
    "server_timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "recall_portal_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_message" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "stakeholder_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "template_id" TEXT,
    "body_encrypted" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider_ref" TEXT,
    "is_drill" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_quarantine_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "stakeholder_id" UUID,
    "batch_id" UUID NOT NULL,
    "full_packs" INTEGER NOT NULL DEFAULT 0,
    "part_packs" JSONB,
    "evidence_document_ids" TEXT[],
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_quarantine_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_return_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "from_org_id" UUID,
    "batch_scanned_gtin" TEXT,
    "batch_scanned_lot" TEXT,
    "batch_scanned_expiry" DATE,
    "batch_scanned_serial" TEXT,
    "batch_id" UUID,
    "qty" INTEGER NOT NULL,
    "verdict" TEXT,
    "verdict_note" TEXT,
    "credit_status" TEXT NOT NULL DEFAULT 'pending',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_return_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_reconciliation_snapshot" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_country_id" UUID NOT NULL,
    "distributed" INTEGER NOT NULL,
    "recovered" INTEGER NOT NULL,
    "quarantined" INTEGER NOT NULL,
    "dispensed" INTEGER NOT NULL,
    "other" INTEGER NOT NULL,
    "accounted" INTEGER NOT NULL,
    "outstanding" INTEGER NOT NULL,
    "destroyed" INTEGER NOT NULL,
    "held_by_mah" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_reconciliation_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_discrepancy" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "recall_country_id" UUID,
    "units" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "owner_user_id" UUID,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'open',
    "exception_approval_note" TEXT,
    "exception_approved_by" UUID,
    "exception_approved_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_destruction_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_country_id" UUID NOT NULL,
    "units" INTEGER NOT NULL,
    "disposal_approval_evidence_id" UUID,
    "destroyed_by" UUID,
    "destroyed_at" TIMESTAMPTZ(3),
    "certificate_evidence_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_destruction_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_effectiveness_check" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_country_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "clear" INTEGER NOT NULL,
    "stock_found" INTEGER NOT NULL,
    "follow_up_task_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "performed_by" UUID,
    "performed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_effectiveness_check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recall_rule_set_country_id_regulatory_authority_id_version_key" ON "recall_rule_set"("country_id", "regulatory_authority_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recall_rule_rule_set_id_code_key" ON "recall_rule"("rule_set_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "recall_submission_template_rule_set_id_code_key" ON "recall_submission_template"("rule_set_id", "code");

-- CreateIndex
CREATE INDEX "recall_submission_company_id_recall_country_id_idx" ON "recall_submission"("company_id", "recall_country_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_country_recall_id_country_id_key" ON "recall_country"("recall_id", "country_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_requirement_recall_country_id_recall_rule_id_key" ON "recall_requirement"("recall_country_id", "recall_rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_scope_version_recall_id_version_key" ON "recall_scope_version"("recall_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recall_scope_item_scope_version_id_batch_id_key" ON "recall_scope_item"("scope_version_id", "batch_id");

-- CreateIndex
CREATE INDEX "stakeholder_company_id_idx" ON "stakeholder"("company_id");

-- CreateIndex
CREATE INDEX "recall_distribution_record_company_id_recall_id_idx" ON "recall_distribution_record"("company_id", "recall_id");

-- CreateIndex
CREATE INDEX "recall_import_job_company_id_recall_id_idx" ON "recall_import_job"("company_id", "recall_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_cascade_invite_recall_id_stakeholder_id_key" ON "recall_cascade_invite"("recall_id", "stakeholder_id");

-- CreateIndex
CREATE INDEX "recall_sighting_company_id_recall_id_idx" ON "recall_sighting"("company_id", "recall_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_portal_link_token_hash_key" ON "recall_portal_link"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "recall_portal_action_link_id_idempotency_key_key" ON "recall_portal_action"("link_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "recall_message_company_id_recall_id_idx" ON "recall_message"("company_id", "recall_id");

-- CreateIndex
CREATE INDEX "recall_quarantine_record_company_id_recall_id_idx" ON "recall_quarantine_record"("company_id", "recall_id");

-- CreateIndex
CREATE INDEX "recall_return_record_company_id_recall_id_idx" ON "recall_return_record"("company_id", "recall_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_return_record_company_id_ref_key" ON "recall_return_record"("company_id", "ref");

-- CreateIndex
CREATE INDEX "recall_reconciliation_snapshot_company_id_recall_country_id_idx" ON "recall_reconciliation_snapshot"("company_id", "recall_country_id");

-- CreateIndex
CREATE INDEX "recall_discrepancy_company_id_recall_id_idx" ON "recall_discrepancy"("company_id", "recall_id");

-- CreateIndex
CREATE INDEX "recall_destruction_record_company_id_recall_country_id_idx" ON "recall_destruction_record"("company_id", "recall_country_id");

-- CreateIndex
CREATE INDEX "recall_effectiveness_check_company_id_recall_country_id_idx" ON "recall_effectiveness_check"("company_id", "recall_country_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_ref_key" ON "recall"("ref");

-- AddForeignKey
ALTER TABLE "recall_rule_set" ADD CONSTRAINT "recall_rule_set_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_rule_set" ADD CONSTRAINT "recall_rule_set_regulatory_authority_id_fkey" FOREIGN KEY ("regulatory_authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_rule_set" ADD CONSTRAINT "recall_rule_set_signed_off_by_fkey" FOREIGN KEY ("signed_off_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_rule_set" ADD CONSTRAINT "recall_rule_set_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_rule" ADD CONSTRAINT "recall_rule_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "recall_rule_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_rule" ADD CONSTRAINT "recall_rule_submission_template_id_fkey" FOREIGN KEY ("submission_template_id") REFERENCES "recall_submission_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission_template" ADD CONSTRAINT "recall_submission_template_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "recall_rule_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "recall_submission_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_submitted_proof_document_id_fkey" FOREIGN KEY ("submitted_proof_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_submission" ADD CONSTRAINT "recall_submission_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_country" ADD CONSTRAINT "recall_country_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_country" ADD CONSTRAINT "recall_country_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_country" ADD CONSTRAINT "recall_country_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_country" ADD CONSTRAINT "recall_country_regulatory_authority_id_fkey" FOREIGN KEY ("regulatory_authority_id") REFERENCES "regulatory_authority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_country" ADD CONSTRAINT "recall_country_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "recall_rule_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_requirement" ADD CONSTRAINT "recall_requirement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_requirement" ADD CONSTRAINT "recall_requirement_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_requirement" ADD CONSTRAINT "recall_requirement_recall_rule_id_fkey" FOREIGN KEY ("recall_rule_id") REFERENCES "recall_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_version" ADD CONSTRAINT "recall_scope_version_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_version" ADD CONSTRAINT "recall_scope_version_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_version" ADD CONSTRAINT "recall_scope_version_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_version" ADD CONSTRAINT "recall_scope_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_item" ADD CONSTRAINT "recall_scope_item_scope_version_id_fkey" FOREIGN KEY ("scope_version_id") REFERENCES "recall_scope_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_item" ADD CONSTRAINT "recall_scope_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_scope_item" ADD CONSTRAINT "recall_scope_item_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakeholder" ADD CONSTRAINT "stakeholder_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakeholder" ADD CONSTRAINT "stakeholder_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "stakeholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakeholder" ADD CONSTRAINT "stakeholder_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_from_org_id_fkey" FOREIGN KEY ("from_org_id") REFERENCES "stakeholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_to_org_id_fkey" FOREIGN KEY ("to_org_id") REFERENCES "stakeholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_distribution_record" ADD CONSTRAINT "recall_distribution_record_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "recall_import_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_import_job" ADD CONSTRAINT "recall_import_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_import_job" ADD CONSTRAINT "recall_import_job_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_import_job" ADD CONSTRAINT "recall_import_job_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_import_job" ADD CONSTRAINT "recall_import_job_source_org_id_fkey" FOREIGN KEY ("source_org_id") REFERENCES "stakeholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_import_job" ADD CONSTRAINT "recall_import_job_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_cascade_invite" ADD CONSTRAINT "recall_cascade_invite_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_cascade_invite" ADD CONSTRAINT "recall_cascade_invite_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_cascade_invite" ADD CONSTRAINT "recall_cascade_invite_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "stakeholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_sighting" ADD CONSTRAINT "recall_sighting_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_sighting" ADD CONSTRAINT "recall_sighting_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_sighting" ADD CONSTRAINT "recall_sighting_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_sighting" ADD CONSTRAINT "recall_sighting_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_sighting" ADD CONSTRAINT "recall_sighting_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_portal_link" ADD CONSTRAINT "recall_portal_link_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_portal_link" ADD CONSTRAINT "recall_portal_link_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_portal_link" ADD CONSTRAINT "recall_portal_link_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "stakeholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_portal_link" ADD CONSTRAINT "recall_portal_link_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_portal_action" ADD CONSTRAINT "recall_portal_action_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "recall_portal_link"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_message" ADD CONSTRAINT "recall_message_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_message" ADD CONSTRAINT "recall_message_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_message" ADD CONSTRAINT "recall_message_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "stakeholder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_message" ADD CONSTRAINT "recall_message_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_quarantine_record" ADD CONSTRAINT "recall_quarantine_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_quarantine_record" ADD CONSTRAINT "recall_quarantine_record_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_quarantine_record" ADD CONSTRAINT "recall_quarantine_record_stakeholder_id_fkey" FOREIGN KEY ("stakeholder_id") REFERENCES "stakeholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_quarantine_record" ADD CONSTRAINT "recall_quarantine_record_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_quarantine_record" ADD CONSTRAINT "recall_quarantine_record_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_from_org_id_fkey" FOREIGN KEY ("from_org_id") REFERENCES "stakeholder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_return_record" ADD CONSTRAINT "recall_return_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_reconciliation_snapshot" ADD CONSTRAINT "recall_reconciliation_snapshot_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_reconciliation_snapshot" ADD CONSTRAINT "recall_reconciliation_snapshot_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_exception_approved_by_fkey" FOREIGN KEY ("exception_approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_discrepancy" ADD CONSTRAINT "recall_discrepancy_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_disposal_approval_evidence_id_fkey" FOREIGN KEY ("disposal_approval_evidence_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_destroyed_by_fkey" FOREIGN KEY ("destroyed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_certificate_evidence_id_fkey" FOREIGN KEY ("certificate_evidence_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_destruction_record" ADD CONSTRAINT "recall_destruction_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_effectiveness_check" ADD CONSTRAINT "recall_effectiveness_check_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_effectiveness_check" ADD CONSTRAINT "recall_effectiveness_check_recall_country_id_fkey" FOREIGN KEY ("recall_country_id") REFERENCES "recall_country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_effectiveness_check" ADD CONSTRAINT "recall_effectiveness_check_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- RLS
-- `recall_rule_set`, `recall_rule`, `recall_submission_template` deliberately have NO row-level security —
-- platform-wide reference/config data scoped by country/authority, not by tenant, matching
-- `InspectionChecklistTemplate`'s own exact precedent.

ALTER TABLE "recall_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_submission"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_country" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_country" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_country"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_requirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_requirement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_requirement"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_scope_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_scope_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_scope_version"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

-- `recall_scope_item` has no own company_id — mirrors `specification_parameter`'s own established EXISTS-join RLS shape.
ALTER TABLE "recall_scope_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_scope_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_scope_item"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "recall_scope_version" v
      WHERE v.id = recall_scope_item.scope_version_id
        AND v.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "recall_scope_version" v
      WHERE v.id = recall_scope_item.scope_version_id
        AND v.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );

ALTER TABLE "stakeholder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stakeholder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stakeholder"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_distribution_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_distribution_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_distribution_record"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_import_job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_import_job" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_import_job"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_cascade_invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_cascade_invite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_cascade_invite"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_sighting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_sighting" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_sighting"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_portal_link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_portal_link" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_portal_link"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

-- `recall_portal_action` has no own company_id — same EXISTS-join shape via its parent link.
ALTER TABLE "recall_portal_action" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_portal_action" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_portal_action"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "recall_portal_link" l
      WHERE l.id = recall_portal_action.link_id
        AND l.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "recall_portal_link" l
      WHERE l.id = recall_portal_action.link_id
        AND l.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );

ALTER TABLE "recall_message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_message"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_quarantine_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_quarantine_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_quarantine_record"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_return_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_return_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_return_record"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_reconciliation_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_reconciliation_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_reconciliation_snapshot"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_discrepancy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_discrepancy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_discrepancy"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_destruction_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_destruction_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_destruction_record"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');

ALTER TABLE "recall_effectiveness_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_effectiveness_check" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_effectiveness_check"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'true');
