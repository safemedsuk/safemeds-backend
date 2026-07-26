-- VigiCloud Stage 3.4 — WhatsApp intake's optional packaging-photo
-- attachment is uploaded with no logged-in human actor at all, the same
-- "system channel" situation Stage 3's `phase11_stage3_multichannel_intake`
-- migration already solved for `pv_case.created_by`. `document.created_by`
-- and `document_version.uploaded_by` need the identical treatment.
--
-- Note: the raw `prisma migrate diff` output this was hand-assembled from
-- also included `DropIndex` statements against `audit_entry_occurred_at_brin_idx`
-- and five hand-written trigram indexes (`meddra_term_name_trgm_idx`,
-- `product_atc_code_trgm_idx`, `product_brand_name_trgm_idx`,
-- `product_generic_name_trgm_idx`, `product_inn_name_trgm_idx`,
-- `product_registration_number_trgm_idx`) — the same known false positive
-- that has recurred in every migration this session (Prisma's schema
-- diffing doesn't know about indexes created via raw SQL outside its own
-- `@@index`/`@@unique` declarations). Deliberately not included here.

-- DropForeignKey
ALTER TABLE "document" DROP CONSTRAINT "document_created_by_fkey";

-- DropForeignKey
ALTER TABLE "document_version" DROP CONSTRAINT "document_version_uploaded_by_fkey";

-- AlterTable
ALTER TABLE "document" ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "document_version" ALTER COLUMN "uploaded_by" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
