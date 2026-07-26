-- VigiCloud Phase 11 Stage 12 — Regulatory Submission (E2B, No Gateway).
-- The diff's own 8 DropIndex statements (audit_entry's BRIN index + the 7
-- pg_trgm indexes on product/registration/meddra_term/who_drug_term) are
-- the same known false positive documented in CLAUDE.md's gotchas list
-- (Prisma's schema diffing doesn't recognize indexes created via raw SQL
-- in earlier migrations) and have been stripped here, exactly like every
-- prior migration in this repo that touched a table carrying one of them.

-- AlterTable: sender-correspondence fields for the E2B `sender` block and
-- the generated PDF's "Information on Sender" section.
ALTER TABLE "company" ADD COLUMN     "registered_address" TEXT,
ADD COLUMN     "regulatory_contact_email" TEXT,
ADD COLUMN     "regulatory_contact_phone" TEXT;

-- AlterTable: formal state name for regulatory-letterhead use.
ALTER TABLE "country" ADD COLUMN     "official_name" TEXT;

-- AlterTable: official-document letterhead fields, all nullable — see
-- `RegulatoryAuthority.emblemAssetKey`'s own schema doc comment for why.
ALTER TABLE "regulatory_authority" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "emblem_asset_key" TEXT,
ADD COLUMN     "form_code" TEXT,
ADD COLUMN     "ministry_name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "po_box_address" TEXT;

-- CreateTable: one row per generated E2B submission attempt for a case
-- (initial + every resubmission), never updated in place beyond the
-- evidence fields attached after the fact.
CREATE TABLE "regulatory_submission" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "submission_number" INTEGER NOT NULL,
    "authority_id" UUID NOT NULL,
    "reportable" BOOLEAN NOT NULL,
    "reportability_reason" TEXT NOT NULL,
    "xml_document_id" UUID NOT NULL,
    "pdf_document_id" UUID NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "evidence_document_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regulatory_submission_company_id_case_id_idx" ON "regulatory_submission"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_submission_case_id_submission_number_key" ON "regulatory_submission"("case_id", "submission_number");

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_xml_document_id_fkey" FOREIGN KEY ("xml_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_submission" ADD CONSTRAINT "regulatory_submission_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
