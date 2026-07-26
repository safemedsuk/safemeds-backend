-- NOTE: Prisma's drift detection proposes dropping the hand-written raw-SQL
-- BRIN index on audit_entry.occurred_at and the gin_trgm_ops trigram indexes
-- on product/meddra_term, since they weren't created via a tracked
-- `CREATE INDEX` in a way Prisma's introspection recognizes as matching the
-- schema. These are NOT schema drift — they're deliberate, hand-added
-- indexes (see the migrations that created them) and must never be dropped.
-- The generated DROP INDEX statements have been removed from this file.

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "atc_code" TEXT,
ADD COLUMN     "formulation" TEXT,
ADD COLUMN     "inn_name" TEXT,
ADD COLUMN     "pack_sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "route_of_administration" TEXT,
ADD COLUMN     "site_of_manufacture" TEXT;

-- AlterTable
ALTER TABLE "pv_suspect_product" ADD COLUMN     "product_id" UUID;

-- CreateIndex
CREATE INDEX "pv_suspect_product_company_id_product_id_idx" ON "pv_suspect_product"("company_id", "product_id");

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- pg_trgm trigram search over the two new product-picker search fields
-- (Stage 2's own "select by brand, INN, or ATC code" requirement) — same
-- pattern as the existing brand_name/generic_name indexes from
-- phase7_1_master_data. `pg_trgm` is already enabled by that migration.
CREATE INDEX "product_inn_name_trgm_idx" ON "product" USING GIN ("inn_name" gin_trgm_ops);
CREATE INDEX "product_atc_code_trgm_idx" ON "product" USING GIN ("atc_code" gin_trgm_ops);
