-- The 8 `DROP INDEX` statements Prisma's own diff engine generated here have
-- been removed by hand — every one is a real, hand-written BRIN/trigram
-- index (audit_entry's occurred_at BRIN index, and pg_trgm GIN indexes on
-- product/meddra_term/who_drug_term) that has no @@index equivalent in
-- schema.prisma, so Prisma's diff concludes it shouldn't exist. This is the
-- exact, previously-documented gotcha (CLAUDE.md: "prisma migrate dev
-- --create-only will happily generate DROP INDEX statements for real,
-- functioning indexes it simply doesn't know about") — never apply this
-- migration's raw output without reading it first.

-- AlterTable
ALTER TABLE "product_registration" ADD COLUMN     "local_representative_id" UUID,
ADD COLUMN     "mah_country" TEXT,
ADD COLUMN     "mah_name" TEXT,
ADD COLUMN     "manufacturing_site_id" UUID,
ADD COLUMN     "product_class" TEXT;

-- CreateTable
CREATE TABLE "regulatory_requirement" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "product_class" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT '*',
    "standard_timeline_days" INTEGER,
    "description" TEXT,
    "unverified" BOOLEAN NOT NULL DEFAULT true,
    "source_reference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regulatory_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "required_document_definition" (
    "id" UUID NOT NULL,
    "regulatory_requirement_id" UUID NOT NULL,
    "document_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ctd_module" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "source_reference" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "required_document_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_fee_schedule" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "product_class" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT '*',
    "fee_type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "unverified" BOOLEAN NOT NULL DEFAULT true,
    "source_reference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regulatory_fee_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturer" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_site" (
    "id" UUID NOT NULL,
    "manufacturer_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "site_name" TEXT NOT NULL,
    "country_id" UUID,
    "address" TEXT,
    "gmp_certificate_number" TEXT,
    "gmp_certificate_expires_on" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manufacturing_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_representative" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "local_representative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_dossier" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "product_class" TEXT NOT NULL,
    "route" TEXT NOT NULL DEFAULT '*',
    "regulatory_requirement_id" UUID,
    "product_registration_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'compiling',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_dossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_dossier_document_slot" (
    "id" UUID NOT NULL,
    "reg_dossier_id" UUID NOT NULL,
    "required_document_definition_id" UUID,
    "label_override" TEXT,
    "document_id" UUID,
    "ctd_module" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_dossier_document_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_deadline_rule" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "product_class" TEXT NOT NULL DEFAULT '*',
    "obligation_type" TEXT NOT NULL,
    "interval_value" INTEGER NOT NULL,
    "interval_unit" TEXT NOT NULL,
    "clock_start" TEXT NOT NULL DEFAULT 'issued_on',
    "unverified" BOOLEAN NOT NULL DEFAULT true,
    "source_reference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_deadline_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_deadline" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "reg_deadline_rule_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'pending',
    "notified_at_180d" TIMESTAMPTZ(3),
    "notified_at_90d" TIMESTAMPTZ(3),
    "notified_at_30d" TIMESTAMPTZ(3),
    "breached_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_deadline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regulatory_requirement_country_id_authority_id_product_clas_idx" ON "regulatory_requirement"("country_id", "authority_id", "product_class", "route", "status");

-- CreateIndex
CREATE INDEX "required_document_definition_regulatory_requirement_id_idx" ON "required_document_definition"("regulatory_requirement_id");

-- CreateIndex
CREATE INDEX "regulatory_fee_schedule_country_id_authority_id_product_cla_idx" ON "regulatory_fee_schedule"("country_id", "authority_id", "product_class", "route", "fee_type", "status");

-- CreateIndex
CREATE INDEX "manufacturer_company_id_idx" ON "manufacturer"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_site_company_id_idx" ON "manufacturing_site"("company_id");

-- CreateIndex
CREATE INDEX "manufacturing_site_manufacturer_id_idx" ON "manufacturing_site"("manufacturer_id");

-- CreateIndex
CREATE INDEX "local_representative_company_id_idx" ON "local_representative"("company_id");

-- CreateIndex
CREATE INDEX "reg_dossier_company_id_idx" ON "reg_dossier"("company_id");

-- CreateIndex
CREATE INDEX "reg_dossier_company_id_product_id_idx" ON "reg_dossier"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "reg_dossier_document_slot_reg_dossier_id_idx" ON "reg_dossier_document_slot"("reg_dossier_id");

-- CreateIndex
CREATE INDEX "reg_deadline_rule_country_id_authority_id_product_class_obl_idx" ON "reg_deadline_rule"("country_id", "authority_id", "product_class", "obligation_type", "status");

-- CreateIndex
CREATE INDEX "reg_deadline_company_id_status_due_at_idx" ON "reg_deadline"("company_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "reg_deadline_record_type_record_id_key" ON "reg_deadline"("record_type", "record_id");

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_manufacturing_site_id_fkey" FOREIGN KEY ("manufacturing_site_id") REFERENCES "manufacturing_site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_local_representative_id_fkey" FOREIGN KEY ("local_representative_id") REFERENCES "local_representative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_requirement" ADD CONSTRAINT "regulatory_requirement_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_requirement" ADD CONSTRAINT "regulatory_requirement_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "required_document_definition" ADD CONSTRAINT "required_document_definition_regulatory_requirement_id_fkey" FOREIGN KEY ("regulatory_requirement_id") REFERENCES "regulatory_requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_fee_schedule" ADD CONSTRAINT "regulatory_fee_schedule_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_fee_schedule" ADD CONSTRAINT "regulatory_fee_schedule_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer" ADD CONSTRAINT "manufacturer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer" ADD CONSTRAINT "manufacturer_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_site" ADD CONSTRAINT "manufacturing_site_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_site" ADD CONSTRAINT "manufacturing_site_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_site" ADD CONSTRAINT "manufacturing_site_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_representative" ADD CONSTRAINT "local_representative_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_representative" ADD CONSTRAINT "local_representative_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_regulatory_requirement_id_fkey" FOREIGN KEY ("regulatory_requirement_id") REFERENCES "regulatory_requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier_document_slot" ADD CONSTRAINT "reg_dossier_document_slot_reg_dossier_id_fkey" FOREIGN KEY ("reg_dossier_id") REFERENCES "reg_dossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier_document_slot" ADD CONSTRAINT "reg_dossier_document_slot_required_document_definition_id_fkey" FOREIGN KEY ("required_document_definition_id") REFERENCES "required_document_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier_document_slot" ADD CONSTRAINT "reg_dossier_document_slot_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_deadline_rule" ADD CONSTRAINT "reg_deadline_rule_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_deadline_rule" ADD CONSTRAINT "reg_deadline_rule_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_deadline" ADD CONSTRAINT "reg_deadline_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_deadline" ADD CONSTRAINT "reg_deadline_reg_deadline_rule_id_fkey" FOREIGN KEY ("reg_deadline_rule_id") REFERENCES "reg_deadline_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes — "at most one active version per natural key",
-- matching `reporting_rule_one_active_per_key`'s own precedent (Phase 4.1)
-- exactly; Prisma's schema language cannot express a partial index
-- directly, so these are hand-added here, not generated.
CREATE UNIQUE INDEX "regulatory_requirement_one_active_per_key"
  ON "regulatory_requirement" ("country_id", "authority_id", "product_class", "route")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "regulatory_fee_schedule_one_active_per_key"
  ON "regulatory_fee_schedule" ("country_id", "authority_id", "product_class", "route", "fee_type")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "reg_deadline_rule_one_active_per_key"
  ON "reg_deadline_rule" ("country_id", "authority_id", "product_class", "obligation_type")
  WHERE "status" = 'active';
