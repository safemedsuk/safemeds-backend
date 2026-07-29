-- The 8 leading DROP INDEX statements Prisma's own diff proposed here are
-- spurious — they target real, hand-written BRIN/trigram indexes
-- (audit_entry's occurred_at BRIN index, and pg_trgm GIN indexes on
-- meddra_term/product/who_drug_term) that have no @@index equivalent in
-- schema.prisma and therefore aren't visible to Prisma's diff engine.
-- Stripped per this project's own established discipline (see CLAUDE.md's
-- "prisma migrate dev --create-only will happily generate DROP INDEX..."
-- gotcha) — applying them would silently destroy real, load-bearing
-- infrastructure unrelated to this migration's actual schema change.

-- AlterTable
ALTER TABLE "import_export_permit" ADD COLUMN     "clinical_trial_id" UUID;

-- AlterTable
ALTER TABLE "reg_dossier" ADD COLUMN     "clinical_trial_id" UUID;

-- CreateTable
CREATE TABLE "promotional_material_submission" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "material_type" TEXT NOT NULL,
    "material_document_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotional_material_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "initiated_by" UUID,
    "recall_class" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reported',
    "authority_notified_at" TIMESTAMPTZ(3),
    "root_cause_capa_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_case" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recall_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotional_material_submission_company_id_product_id_idx" ON "promotional_material_submission"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "recall_company_id_product_id_idx" ON "recall"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "recall_case_company_id_case_id_idx" ON "recall_case"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_case_recall_id_case_id_key" ON "recall_case"("recall_id", "case_id");

-- CreateIndex
CREATE INDEX "reg_dossier_company_id_clinical_trial_id_idx" ON "reg_dossier"("company_id", "clinical_trial_id");

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_clinical_trial_id_fkey" FOREIGN KEY ("clinical_trial_id") REFERENCES "clinical_trial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_clinical_trial_id_fkey" FOREIGN KEY ("clinical_trial_id") REFERENCES "clinical_trial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_material_submission" ADD CONSTRAINT "promotional_material_submission_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_material_submission" ADD CONSTRAINT "promotional_material_submission_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_material_submission" ADD CONSTRAINT "promotional_material_submission_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_material_submission" ADD CONSTRAINT "promotional_material_submission_material_document_id_fkey" FOREIGN KEY ("material_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotional_material_submission" ADD CONSTRAINT "promotional_material_submission_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall" ADD CONSTRAINT "recall_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall" ADD CONSTRAINT "recall_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall" ADD CONSTRAINT "recall_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall" ADD CONSTRAINT "recall_root_cause_capa_id_fkey" FOREIGN KEY ("root_cause_capa_id") REFERENCES "capa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall" ADD CONSTRAINT "recall_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_case" ADD CONSTRAINT "recall_case_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_case" ADD CONSTRAINT "recall_case_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_case" ADD CONSTRAINT "recall_case_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Real Postgres RLS, built in from the start (not retroactively) — per
-- this project's own established discipline since the Stage 0.6
-- RLS-hardening pass. All three new tables carry `company_id` directly,
-- same standard per-company template as every other tenant table
-- (including `recall_case`, which — unlike `reg_post_market_obligation_
-- fulfillment` — was deliberately given its own `company_id` column,
-- mirroring `SignalCase`'s own precedent exactly, so it needs no
-- EXISTS-subquery variant).

ALTER TABLE "promotional_material_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotional_material_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "promotional_material_submission"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "recall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "recall_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recall_case" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recall_case"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
