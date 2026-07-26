-- CreateEnum
CREATE TYPE "PregnancyOutcome" AS ENUM ('ongoing', 'live_birth_normal', 'live_birth_congenital_anomaly', 'spontaneous_abortion', 'elective_termination', 'stillbirth', 'ectopic_pregnancy', 'unknown');

-- DropForeignKey
-- `pv_case.created_by` is becoming nullable (see the AlterTable below) —
-- re-adding this FK with ON DELETE SET NULL, matching Prisma's own default
-- for an optional relation, and matching reality: a case with no creator
-- (public/email/WhatsApp intake) has nothing to cascade-restrict against.
ALTER TABLE "pv_case" DROP CONSTRAINT "pv_case_created_by_fkey";

-- NOTE: Prisma's drift detection proposes dropping the hand-written raw-SQL
-- BRIN index on audit_entry.occurred_at and the gin_trgm_ops trigram indexes
-- on product/meddra_term, since they weren't created via a tracked
-- `CREATE INDEX` in a way Prisma's introspection recognizes as matching the
-- schema. These are NOT schema drift — they're deliberate, hand-added
-- indexes (see the migrations that created them) and must never be dropped.
-- The generated DROP INDEX statements have been removed from this file.

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "intake_email_address" TEXT,
ADD COLUMN     "public_reporting_slug" TEXT,
ADD COLUMN     "whatsapp_business_phone_number_id" TEXT;

-- AlterTable
ALTER TABLE "pv_adverse_event" ADD COLUMN     "is_lack_of_efficacy" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pv_case" ADD COLUMN     "requires_draft_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_channel_reference" TEXT,
ADD COLUMN     "suspected_falsified_or_substandard" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pv_suspect_product" ADD COLUMN     "is_medication_error" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_misuse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_off_label_use" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_overdose" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pv_pregnancy_context" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "expected_delivery_date" DATE,
    "gestation_weeks_at_exposure" INTEGER,
    "outcome" "PregnancyOutcome" NOT NULL DEFAULT 'ongoing',
    "congenital_anomaly_detail" TEXT,
    "follow_up_due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pv_pregnancy_context_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pv_pregnancy_context_case_id_key" ON "pv_pregnancy_context"("case_id");

-- CreateIndex
CREATE INDEX "pv_pregnancy_context_company_id_case_id_idx" ON "pv_pregnancy_context"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_public_reporting_slug_key" ON "company"("public_reporting_slug");

-- CreateIndex
CREATE UNIQUE INDEX "company_intake_email_address_key" ON "company"("intake_email_address");

-- CreateIndex
CREATE UNIQUE INDEX "company_whatsapp_business_phone_number_id_key" ON "company"("whatsapp_business_phone_number_id");

-- CreateIndex
CREATE INDEX "pv_case_company_id_requires_draft_review_idx" ON "pv_case"("company_id", "requires_draft_review");

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_pregnancy_context" ADD CONSTRAINT "pv_pregnancy_context_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_pregnancy_context" ADD CONSTRAINT "pv_pregnancy_context_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — pv_pregnancy_context is the only new tenant-owned table.
ALTER TABLE "pv_pregnancy_context" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_pregnancy_context" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_pregnancy_context"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
