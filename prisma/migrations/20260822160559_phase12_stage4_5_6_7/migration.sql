-- AlterEnum
ALTER TYPE "SubmissionChannel" ADD VALUE 'email';

-- NOTE: `prisma migrate dev --create-only` proposed 8 `DROP INDEX`
-- statements here against real, load-bearing hand-written BRIN/trigram
-- indexes (audit_entry's own BRIN index, and 7 pg_trgm GIN indexes on
-- product/meddra_term/who_drug_term) that have zero relationship to
-- this migration's actual schema change — Prisma's diff engine can't
-- see indexes it didn't create via `@@index`, so it assumes they
-- shouldn't exist. Stripped by hand per the project's own established
-- discipline (CLAUDE.md gotchas list) — never apply Prisma's own
-- generated migration output verbatim without reading it first.

-- CreateTable
CREATE TABLE "reg_submission" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reg_dossier_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "submission_number" INTEGER NOT NULL,
    "channel" "SubmissionChannel" NOT NULL,
    "cover_sheet_document_id" UUID NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "evidence_document_id" UUID,
    "dispatched_at" TIMESTAMPTZ(3),
    "dispatched_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_query" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reg_dossier_id" UUID NOT NULL,
    "received_date" DATE NOT NULL,
    "query_text_encrypted" TEXT NOT NULL,
    "query_letter_document_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "responded_at" TIMESTAMPTZ(3),
    "response_document_id" UUID,
    "responded_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_variation" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_registration_id" UUID NOT NULL,
    "variation_type" TEXT NOT NULL,
    "reg_dossier_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_variation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reg_submission_company_id_reg_dossier_id_idx" ON "reg_submission"("company_id", "reg_dossier_id");

-- CreateIndex
CREATE UNIQUE INDEX "reg_submission_reg_dossier_id_submission_number_key" ON "reg_submission"("reg_dossier_id", "submission_number");

-- CreateIndex
CREATE INDEX "reg_query_company_id_reg_dossier_id_idx" ON "reg_query"("company_id", "reg_dossier_id");

-- CreateIndex
CREATE UNIQUE INDEX "reg_variation_reg_dossier_id_key" ON "reg_variation"("reg_dossier_id");

-- CreateIndex
CREATE INDEX "reg_variation_company_id_product_registration_id_idx" ON "reg_variation"("company_id", "product_registration_id");

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_reg_dossier_id_fkey" FOREIGN KEY ("reg_dossier_id") REFERENCES "reg_dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_cover_sheet_document_id_fkey" FOREIGN KEY ("cover_sheet_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_submission" ADD CONSTRAINT "reg_submission_dispatched_by_fkey" FOREIGN KEY ("dispatched_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_reg_dossier_id_fkey" FOREIGN KEY ("reg_dossier_id") REFERENCES "reg_dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_query_letter_document_id_fkey" FOREIGN KEY ("query_letter_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_response_document_id_fkey" FOREIGN KEY ("response_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_responded_by_fkey" FOREIGN KEY ("responded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_reg_dossier_id_fkey" FOREIGN KEY ("reg_dossier_id") REFERENCES "reg_dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RegCloud (Phase 12) Stage 4/5/7 — real Postgres RLS built in from the
-- start (unlike Stage 0.1-0.4's tables, which needed the Stage 0.6
-- retroactive-hardening pass) — all three new tables carry `company_id`
-- directly, same template as `manufacturer`/`reg_dossier`/`reg_fee_invoice`.
ALTER TABLE "reg_submission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_submission" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_submission"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_query" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_query" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_query"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_variation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_variation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_variation"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
