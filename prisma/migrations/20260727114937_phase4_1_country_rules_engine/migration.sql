-- CreateEnum
CREATE TYPE "ConfigStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('calendar', 'business');

-- CreateEnum
CREATE TYPE "SubmissionChannel" AS ENUM ('vigiflow', 'dhis2', 'portal', 'paper_pdf');

-- NOTE: `prisma migrate diff` wanted to drop `audit_entry_occurred_at_brin_idx`
-- here — Prisma's schema DSL has no BRIN index syntax, so a raw-SQL-created
-- BRIN index (phase3_1 migration) always looks like drift to the diff
-- engine. Deliberately not applying that DROP; the trigger/REVOKE-protected
-- audit_entry table isn't touched by this migration at all.

-- CreateTable
CREATE TABLE "regulatory_authority" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_authority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_type" (
    "id" UUID NOT NULL,
    "type_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_rule" (
    "id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "report_type_id" UUID NOT NULL,
    "seriousness_class" TEXT NOT NULL,
    "window_days" INTEGER NOT NULL,
    "day_type" "DayType" NOT NULL DEFAULT 'calendar',
    "clock_start" TEXT NOT NULL DEFAULT 'awareness_date',
    "unverified" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seriousness_definition" (
    "id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "criterion_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seriousness_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_schema" (
    "id" UUID NOT NULL,
    "country_id" UUID,
    "report_type_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "json_schema" JSONB NOT NULL,
    "official_form_code" TEXT,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_schema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_format" (
    "id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "report_type_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template_ref" TEXT NOT NULL,
    "channel" "SubmissionChannel" NOT NULL,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_format_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_market" (
    "company_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_market_pkey" PRIMARY KEY ("company_id","country_id")
);

-- CreateTable
CREATE TABLE "facility" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "facility_code" TEXT,
    "county" TEXT,
    "sub_county" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_authority_country_id_code_key" ON "regulatory_authority"("country_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "report_type_type_key_key" ON "report_type"("type_key");

-- CreateIndex
CREATE INDEX "reporting_rule_authority_id_report_type_id_seriousness_clas_idx" ON "reporting_rule"("authority_id", "report_type_id", "seriousness_class", "status");

-- CreateIndex
CREATE INDEX "seriousness_definition_authority_id_criterion_key_status_idx" ON "seriousness_definition"("authority_id", "criterion_key", "status");

-- CreateIndex
CREATE INDEX "form_schema_country_id_report_type_id_status_idx" ON "form_schema"("country_id", "report_type_id", "status");

-- CreateIndex
CREATE INDEX "submission_format_authority_id_report_type_id_status_idx" ON "submission_format"("authority_id", "report_type_id", "status");

-- CreateIndex
CREATE INDEX "facility_company_id_idx" ON "facility"("company_id");

-- AddForeignKey
ALTER TABLE "regulatory_authority" ADD CONSTRAINT "regulatory_authority_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reporting_rule" ADD CONSTRAINT "reporting_rule_report_type_id_fkey" FOREIGN KEY ("report_type_id") REFERENCES "report_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seriousness_definition" ADD CONSTRAINT "seriousness_definition_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_schema" ADD CONSTRAINT "form_schema_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_schema" ADD CONSTRAINT "form_schema_report_type_id_fkey" FOREIGN KEY ("report_type_id") REFERENCES "report_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_format" ADD CONSTRAINT "submission_format_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_format" ADD CONSTRAINT "submission_format_report_type_id_fkey" FOREIGN KEY ("report_type_id") REFERENCES "report_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_market" ADD CONSTRAINT "company_market_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_market" ADD CONSTRAINT "company_market_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique indexes: at most one `active` version per natural key, so
-- the "changing a rule creates version N+1, activation retires the old
-- active row" workflow is enforced by Postgres itself, not just application
-- code discipline. `form_schema.country_id` is nullable ("global default"),
-- and NULL never equals NULL in a unique index, so a bare unique index on
-- (country_id, report_type_id) would silently let multiple "active" global
-- defaults for the same report type coexist — coalescing to a sentinel UUID
-- closes that gap.
CREATE UNIQUE INDEX "reporting_rule_one_active_per_key"
  ON "reporting_rule" ("authority_id", "report_type_id", "seriousness_class")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "seriousness_definition_one_active_per_key"
  ON "seriousness_definition" ("authority_id", "criterion_key")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "form_schema_one_active_per_key"
  ON "form_schema" (COALESCE("country_id", '00000000-0000-0000-0000-000000000000'::uuid), "report_type_id")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "submission_format_one_active_per_key"
  ON "submission_format" ("authority_id", "report_type_id")
  WHERE "status" = 'active';

