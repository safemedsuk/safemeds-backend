-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('medicinal', 'blood_product', 'herbal', 'cosmeceutical', 'vaccine', 'device_ivd', 'other');

-- CreateEnum
CREATE TYPE "ProductRegistrationStatus" AS ENUM ('active', 'expired', 'withdrawn', 'suspended');

-- CreateEnum
CREATE TYPE "MeddraLevel" AS ENUM ('SOC', 'HLGT', 'HLT', 'PT', 'LLT');

-- NOTE: as in prior phase 5/6 migrations, deliberately NOT dropping
-- audit_entry_occurred_at_brin_idx — real Phase 3.1 infrastructure, not
-- Prisma-representable, not drift.

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "generic_name" TEXT NOT NULL,
    "product_category" "ProductCategory" NOT NULL,
    "dosage_form" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_registration" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "registration_number" TEXT NOT NULL,
    "status" "ProductRegistrationStatus" NOT NULL DEFAULT 'active',
    "issued_on" DATE NOT NULL,
    "expires_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_number" TEXT NOT NULL,
    "manufactured_on" DATE NOT NULL,
    "expires_on" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meddra_version" (
    "id" UUID NOT NULL,
    "version_label" TEXT NOT NULL,
    "released_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meddra_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meddra_term" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "level" "MeddraLevel" NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,

    CONSTRAINT "meddra_term_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_company_id_idx" ON "product"("company_id");

-- CreateIndex
CREATE INDEX "product_registration_company_id_idx" ON "product_registration"("company_id");

-- CreateIndex
CREATE INDEX "product_registration_product_id_idx" ON "product_registration"("product_id");

-- CreateIndex
CREATE INDEX "product_registration_company_id_expires_on_idx" ON "product_registration"("company_id", "expires_on");

-- CreateIndex
CREATE INDEX "batch_company_id_idx" ON "batch"("company_id");

-- CreateIndex
CREATE INDEX "batch_product_id_idx" ON "batch"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "meddra_version_version_label_key" ON "meddra_version"("version_label");

-- CreateIndex
CREATE INDEX "meddra_term_version_id_level_idx" ON "meddra_term"("version_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "meddra_term_version_id_code_key" ON "meddra_term"("version_id", "code");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch" ADD CONSTRAINT "batch_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meddra_term" ADD CONSTRAINT "meddra_term_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "meddra_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meddra_term" ADD CONSTRAINT "meddra_term_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "meddra_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 7.1 — Postgres RLS on the three tenant-owned master-data tables,
-- same template as phase2_3/phase5_1.
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "product_registration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_registration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_registration"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "batch"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- pg_trgm trigram search — `?q=` typeahead over product/registration/MedDRA
-- names, per the build spec's Phase 7 requirement ("search via pg_trgm").
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "product_brand_name_trgm_idx" ON "product" USING GIN ("brand_name" gin_trgm_ops);
CREATE INDEX "product_generic_name_trgm_idx" ON "product" USING GIN ("generic_name" gin_trgm_ops);
CREATE INDEX "product_registration_number_trgm_idx" ON "product_registration" USING GIN ("registration_number" gin_trgm_ops);
CREATE INDEX "meddra_term_name_trgm_idx" ON "meddra_term" USING GIN ("name" gin_trgm_ops);
