-- VigiCloud Phase 11, Stage 0 — cross-cutting base-engine primitives
-- (ConsentRecord, DataSubjectRequest, RecordVersion, Entitlement). See
-- todo-vigicloud.md Stage 0.1-0.5.
--
-- NOTE: `prisma migrate dev --create-only` also proposed 5 `DROP INDEX`
-- statements against `audit_entry_occurred_at_brin_idx` and 4 trigram
-- indexes on `product`/`meddra_term` — those are real, deliberately
-- hand-written raw-SQL indexes from earlier migrations
-- (phase3_1_audit_immutability, phase4_1/phase7_1) that have no
-- `@@index` representation in schema.prisma (BRIN and `gin_trgm_ops`
-- aren't expressible there), so Prisma's drift detection treats them as
-- "extra" and wants to drop them. Removed from this migration entirely —
-- they must never be dropped.

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('report', 'contact', 'data_privacy');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('verbal', 'written', 'implied');

-- CreateEnum
CREATE TYPE "DataSubjectRequestType" AS ENUM ('export', 'erasure');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('pending', 'completed', 'blocked');

-- CreateTable
CREATE TABLE "consent_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "form_version" INTEGER NOT NULL DEFAULT 1,
    "captured_by" UUID,
    "granted_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_request" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "request_type" "DataSubjectRequestType" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "blocked_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_version" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "reason" TEXT,
    "snapshot" JSONB NOT NULL,
    "previous_version_id" UUID,
    "captured_by" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL DEFAULT '*',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_record_company_id_record_type_record_id_consent_typ_idx" ON "consent_record"("company_id", "record_type", "record_id", "consent_type");

-- CreateIndex
CREATE INDEX "data_subject_request_company_id_record_type_record_id_idx" ON "data_subject_request"("company_id", "record_type", "record_id");

-- CreateIndex
CREATE INDEX "data_subject_request_company_id_status_idx" ON "data_subject_request"("company_id", "status");

-- CreateIndex
CREATE INDEX "record_version_company_id_record_type_record_id_idx" ON "record_version"("company_id", "record_type", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_version_record_type_record_id_version_number_key" ON "record_version"("record_type", "record_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_company_id_module_key_feature_key_key" ON "entitlement"("company_id", "module_key", "feature_key");

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request" ADD CONSTRAINT "data_subject_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_version" ADD CONSTRAINT "record_version_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_version" ADD CONSTRAINT "record_version_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "record_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_version" ADD CONSTRAINT "record_version_captured_by_fkey" FOREIGN KEY ("captured_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement" ADD CONSTRAINT "entitlement_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — same tenant_isolation template as
-- phase2_3_rls_tenant_isolation / phase_tenancy_locations_rls. All four
-- new tables are genuinely tenant-owned (companyId required, never null).

ALTER TABLE "consent_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consent_record"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "data_subject_request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_subject_request" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_subject_request"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "record_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_version"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "entitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entitlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entitlement"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
