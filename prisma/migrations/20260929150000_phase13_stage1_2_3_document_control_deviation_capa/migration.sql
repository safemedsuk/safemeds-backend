-- QualCloud (Phase 13) Stages 1/2/3 — Document Control, Deviation &
-- Non-Conformance Management, CAPA (unified, cross-module).
--
-- Hand-reviewed against `prisma migrate diff`'s own raw output before
-- being applied, per this project's own established discipline — the
-- usual 8 spurious `DROP INDEX` statements against real hand-written
-- BRIN/trigram indexes were stripped before applying (verbatim
-- confirmed against a fresh diff, same 8 indexes every prior migration
-- in this project has hit).
--
-- Three things happen in this one migration:
--   1. `capa` gains the Stage 3 fields (correction/root-cause-category/
--      approval chain/implementation/recurring-flag columns).
--   2. `sop` gains `acknowledgment_window_days` (Stage 1).
--   3. Two brand-new Stage 2 tables (`deviation`, `investigation`) are
--      created, both given real `FORCE ROW LEVEL SECURITY` in this same
--      migration — never retrofitted.

-- AlterTable
ALTER TABLE "capa" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "correction" TEXT,
ADD COLUMN     "flagged_recurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "implemented_at" TIMESTAMPTZ(3),
ADD COLUMN     "recurring_flag_reason" TEXT,
ADD COLUMN     "regulatory_approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "regulatory_approved_by" UUID,
ADD COLUMN     "requires_regulatory_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "root_cause_category" TEXT;

-- AlterTable
ALTER TABLE "sop" ADD COLUMN     "acknowledgment_window_days" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "deviation" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "deviation_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description_encrypted" TEXT,
    "source_type" TEXT NOT NULL,
    "product_id" UUID,
    "batch_id" UUID,
    "equipment_id" UUID,
    "supplier_id" UUID,
    "sop_id" UUID,
    "detected_at" TIMESTAMPTZ(3) NOT NULL,
    "raised_by" UUID,
    "severity" TEXT,
    "risk_assessment_id" UUID,
    "containment_actions" TEXT,
    "investigation_due_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'detected',
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deviation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "deviation_id" UUID NOT NULL,
    "root_cause_method" TEXT,
    "findings" TEXT,
    "evidence_references" TEXT,
    "investigator_user_id" UUID,
    "reviewer_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "investigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deviation_company_id_status_idx" ON "deviation"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deviation_company_id_deviation_number_key" ON "deviation"("company_id", "deviation_number");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_deviation_id_key" ON "investigation"("deviation_id");

-- CreateIndex
CREATE INDEX "investigation_company_id_idx" ON "investigation"("company_id");

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_regulatory_approved_by_fkey" FOREIGN KEY ("regulatory_approved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_risk_assessment_id_fkey" FOREIGN KEY ("risk_assessment_id") REFERENCES "risk_assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deviation" ADD CONSTRAINT "deviation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_deviation_id_fkey" FOREIGN KEY ("deviation_id") REFERENCES "deviation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_investigator_user_id_fkey" FOREIGN KEY ("investigator_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — both new tenant tables, in this same migration.

ALTER TABLE "deviation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deviation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deviation"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "investigation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "investigation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "investigation"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
