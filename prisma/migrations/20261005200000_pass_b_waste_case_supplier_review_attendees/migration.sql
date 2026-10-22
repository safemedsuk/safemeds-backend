-- QualCloud Phase 1 Pass B — waste disposal case (7-step), supplier biennial review
-- and gmp certificate, management review attendees. Hand-written from a dev-DB diff;
-- the spurious DROP INDEX statements (8 hand-written BRIN/trigram indexes not declared
-- in schema.prisma) were stripped. RLS forced on every new tenant table.

-- AlterTable
ALTER TABLE "supplier" ADD COLUMN     "gmp_certificate_document_id" UUID,
ADD COLUMN     "review_reminder_sent_for_due_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "waste_disposal_case" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "product_id" UUID,
    "batch_id" UUID,
    "waste_description" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "weighed_at" TIMESTAMPTZ(3) NOT NULL,
    "application_reference" TEXT,
    "invoice_reference" TEXT,
    "fee_amount_kes" INTEGER,
    "application_submitted_at" TIMESTAMPTZ(3),
    "invoice_document_id" UUID,
    "payment_receipt_document_id" UUID,
    "evidence_attached_at" TIMESTAMPTZ(3),
    "disposal_company_name" TEXT,
    "handover_certificate_document_id" UUID,
    "handed_over_at" TIMESTAMPTZ(3),
    "ppb_verified_at" TIMESTAMPTZ(3),
    "ppb_verified_by_user_id" UUID,
    "destruction_date" DATE,
    "destruction_location" TEXT,
    "destruction_recorded_at" TIMESTAMPTZ(3),
    "destruction_pdf_document_id" UUID,
    "ppb_certificate_document_id" UUID,
    "ppb_certificate_attached_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waste_disposal_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_disposal_case_attendee" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organisation" TEXT NOT NULL,
    "attendee_role" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_disposal_case_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_disposal_case_photo" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_disposal_case_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_performance_review" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "checklist_document_id" UUID NOT NULL,
    "performance_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_review_due_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_performance_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_review_attendee" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "management_review_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role_or_organisation" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "management_review_attendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waste_disposal_case_company_id_status_idx" ON "waste_disposal_case"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waste_disposal_case_company_id_case_number_key" ON "waste_disposal_case"("company_id", "case_number");

-- CreateIndex
CREATE INDEX "waste_disposal_case_attendee_company_id_case_id_idx" ON "waste_disposal_case_attendee"("company_id", "case_id");

-- CreateIndex
CREATE INDEX "waste_disposal_case_photo_company_id_case_id_idx" ON "waste_disposal_case_photo"("company_id", "case_id");

-- CreateIndex
CREATE INDEX "supplier_performance_review_company_id_supplier_id_idx" ON "supplier_performance_review"("company_id", "supplier_id");

-- CreateIndex
CREATE INDEX "management_review_attendee_company_id_management_review_id_idx" ON "management_review_attendee"("company_id", "management_review_id");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_gmp_certificate_document_id_fkey" FOREIGN KEY ("gmp_certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_invoice_document_id_fkey" FOREIGN KEY ("invoice_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_payment_receipt_document_id_fkey" FOREIGN KEY ("payment_receipt_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_handover_certificate_document_id_fkey" FOREIGN KEY ("handover_certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_ppb_verified_by_user_id_fkey" FOREIGN KEY ("ppb_verified_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_destruction_pdf_document_id_fkey" FOREIGN KEY ("destruction_pdf_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_ppb_certificate_document_id_fkey" FOREIGN KEY ("ppb_certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case" ADD CONSTRAINT "waste_disposal_case_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_attendee" ADD CONSTRAINT "waste_disposal_case_attendee_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_attendee" ADD CONSTRAINT "waste_disposal_case_attendee_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "waste_disposal_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_photo" ADD CONSTRAINT "waste_disposal_case_photo_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_photo" ADD CONSTRAINT "waste_disposal_case_photo_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "waste_disposal_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_photo" ADD CONSTRAINT "waste_disposal_case_photo_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_review" ADD CONSTRAINT "supplier_performance_review_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_review" ADD CONSTRAINT "supplier_performance_review_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_review" ADD CONSTRAINT "supplier_performance_review_checklist_document_id_fkey" FOREIGN KEY ("checklist_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_review" ADD CONSTRAINT "supplier_performance_review_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_review_attendee" ADD CONSTRAINT "management_review_attendee_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_review_attendee" ADD CONSTRAINT "management_review_attendee_management_review_id_fkey" FOREIGN KEY ("management_review_id") REFERENCES "management_review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_review_attendee" ADD CONSTRAINT "management_review_attendee_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security (forced, tenant isolation)

ALTER TABLE "waste_disposal_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_disposal_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waste_disposal_case"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "waste_disposal_case_attendee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_disposal_case_attendee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waste_disposal_case_attendee"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "waste_disposal_case_photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_disposal_case_photo" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "waste_disposal_case_photo"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "supplier_performance_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_performance_review" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_performance_review"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "management_review_attendee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_review_attendee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "management_review_attendee"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
