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
ALTER TABLE "company" ADD COLUMN     "engagement_type" TEXT NOT NULL DEFAULT 'full_service';

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "is_external" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reg_dossier" ADD COLUMN     "engagement_type" TEXT,
ADD COLUMN     "reliance_application_id" UUID;

-- CreateTable
CREATE TABLE "reliance_application" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "pathway_type" TEXT NOT NULL,
    "lead_authority_id" UUID NOT NULL,
    "participating_authority_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reliance_application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reliance_application_company_id_product_id_idx" ON "reliance_application"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "reg_dossier_company_id_reliance_application_id_idx" ON "reg_dossier"("company_id", "reliance_application_id");

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_reliance_application_id_fkey" FOREIGN KEY ("reliance_application_id") REFERENCES "reliance_application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliance_application" ADD CONSTRAINT "reliance_application_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliance_application" ADD CONSTRAINT "reliance_application_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliance_application" ADD CONSTRAINT "reliance_application_lead_authority_id_fkey" FOREIGN KEY ("lead_authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reliance_application" ADD CONSTRAINT "reliance_application_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Real Postgres RLS, built in from the start (not retroactively) — per
-- this project's own established discipline since the Stage 0.6
-- RLS-hardening pass. `reliance_application` carries `company_id`
-- directly, same standard per-company template as every other tenant
-- table. `company.engagement_type`, `invitation.is_external`, and
-- `reg_dossier.engagement_type`/`reliance_application_id` are all new
-- columns on already-RLS-protected tables, so they need no new policy
-- of their own.

ALTER TABLE "reliance_application" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reliance_application" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reliance_application"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
