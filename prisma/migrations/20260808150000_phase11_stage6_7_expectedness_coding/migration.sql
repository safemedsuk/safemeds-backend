-- VigiCloud Phase 11 Stage 6 (Expectedness/Listedness) + Stage 7 (MedDRA +
-- WHODrug Coding). Hand-written from `prisma migrate diff`'s raw output —
-- the diff's own 7 DropIndex statements (audit_entry's BRIN index + the 6
-- pg_trgm indexes on product/registration/meddra_term) are the same known
-- false positive documented in CLAUDE.md's gotchas list (Prisma's schema
-- diffing doesn't recognize indexes created via raw SQL in earlier
-- migrations) and have been stripped here, exactly like every prior
-- migration in this repo that touched a table carrying one of those
-- indexes.

-- CreateEnum
CREATE TYPE "ExpectednessFlag" AS ENUM ('listed', 'unlisted', 'not_assessed');

-- AlterTable: Stage 7 — MedDRA coding audit trail on AdverseEvent
ALTER TABLE "pv_adverse_event" ADD COLUMN     "meddra_coded_at" TIMESTAMP(3),
ADD COLUMN     "meddra_coded_by" UUID;

-- AlterTable: Stage 6 — manual expectedness/listedness flag on Case
ALTER TABLE "pv_case" ADD COLUMN     "expectedness_assessed_at" TIMESTAMP(3),
ADD COLUMN     "expectedness_assessed_by" UUID,
ADD COLUMN     "expectedness_flag" "ExpectednessFlag" NOT NULL DEFAULT 'not_assessed',
ADD COLUMN     "expectedness_note_encrypted" TEXT;

-- AlterTable: Stage 7 — WHODrug coding on SuspectProduct
ALTER TABLE "pv_suspect_product" ADD COLUMN     "who_drug_coded_at" TIMESTAMP(3),
ADD COLUMN     "who_drug_coded_by" UUID,
ADD COLUMN     "who_drug_term_id" UUID;

-- CreateTable: Stage 7 — WHODrug global reference data (no company_id, no RLS, same shape as meddra_version)
CREATE TABLE "who_drug_version" (
    "id" UUID NOT NULL,
    "version_label" TEXT NOT NULL,
    "released_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "who_drug_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "who_drug_term" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "drug_record_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "substance_name" TEXT,
    "atc_code" TEXT,

    CONSTRAINT "who_drug_term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "who_drug_version_version_label_key" ON "who_drug_version"("version_label");

-- CreateIndex
CREATE INDEX "who_drug_term_version_id_idx" ON "who_drug_term"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "who_drug_term_version_id_drug_record_number_key" ON "who_drug_term"("version_id", "drug_record_number");

-- AddForeignKey
ALTER TABLE "who_drug_term" ADD CONSTRAINT "who_drug_term_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "who_drug_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_expectedness_assessed_by_fkey" FOREIGN KEY ("expectedness_assessed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_who_drug_term_id_fkey" FOREIGN KEY ("who_drug_term_id") REFERENCES "who_drug_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_suspect_product" ADD CONSTRAINT "pv_suspect_product_who_drug_coded_by_fkey" FOREIGN KEY ("who_drug_coded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_adverse_event" ADD CONSTRAINT "pv_adverse_event_meddra_coded_by_fkey" FOREIGN KEY ("meddra_coded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- pg_trgm trigram search for WHODrug typeahead — mirrors "meddra_term_name_trgm_idx" exactly (pg_trgm extension already created by the phase7_1 migration).
CREATE INDEX "who_drug_term_name_trgm_idx" ON "who_drug_term" USING GIN ("name" gin_trgm_ops);
