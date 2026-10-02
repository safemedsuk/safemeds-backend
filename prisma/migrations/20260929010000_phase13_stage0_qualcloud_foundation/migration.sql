-- QualCloud (Phase 13) Stage 0 — Foundation Layer.
--
-- Hand-reviewed against `prisma migrate diff`'s own raw output before
-- being applied, per this project's own established discipline (see
-- CLAUDE.md's gotchas list — Prisma's diff engine cannot see the 8
-- hand-written BRIN/trigram indexes this schema already has, and always
-- proposes dropping them; those 8 `DROP INDEX` statements are stripped
-- from this file entirely, verbatim confirmed against a fresh diff).
--
-- Three things happen in this one migration, in this order:
--   1. `capa` gains the polymorphic `source_record_type`/`source_record_id`
--      pair (`todo-qualcloud.md` Reconciliation Note 4) and every
--      pre-existing row with a `finding_id` is backfilled to the new
--      shape — a real data migration, not just a schema change.
--   2. `company.quality_profile` is added (default `'both'`, so no
--      existing tenant loses visibility of anything).
--   3. Eight brand-new QualCloud tables are created, every one of them
--      given real `FORCE ROW LEVEL SECURITY` in this exact same
--      migration — never retrofitted, the exact lesson RegCloud Stage
--      0.6 had to learn the hard way after shipping six new tenant
--      tables with zero real RLS despite correct app-level scoping.

-- Backfilling a RLS-`FORCE`d table needs `app.bypass_rls` set for this
-- session, or the UPDATE below silently matches zero rows under the
-- migration runner's own connection (no `app.company_id` session var is
-- ever set for a migration) — see CLAUDE.md's dedicated gotchas entry on
-- exactly this failure mode.
SET LOCAL app.bypass_rls = 'true';

-- AlterTable
ALTER TABLE "capa" ADD COLUMN     "source_record_id" UUID,
ADD COLUMN     "source_record_type" TEXT;

-- Backfill: every existing CAPA already tied to an audit finding gets the
-- new polymorphic pair populated to match — `finding_id` itself is left
-- exactly as it was (never dropped), simply redundant with the new pair
-- for this one source type going forward.
UPDATE "capa" SET "source_record_type" = 'audit_finding', "source_record_id" = "finding_id" WHERE "finding_id" IS NOT NULL;

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "quality_profile" TEXT NOT NULL DEFAULT 'both';

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "supplier_type" TEXT NOT NULL,
    "country_id" UUID,
    "address" TEXT,
    "criticality" TEXT NOT NULL DEFAULT 'non_critical',
    "approval_status" TEXT NOT NULL DEFAULT 'pending',
    "manufacturer_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "facility_id" UUID,
    "name" TEXT NOT NULL,
    "equipment_type" TEXT NOT NULL,
    "asset_tag" TEXT,
    "qualification_status" TEXT NOT NULL DEFAULT 'not_qualified',
    "calibration_due_at" TIMESTAMPTZ(3),
    "last_calibrated_at" TIMESTAMPTZ(3),
    "maintenance_due_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "product_id" UUID,
    "process_area" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effective_date" DATE,
    "next_periodic_review_due_at" DATE,
    "supersedes_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specification" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "specification_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specification_type" TEXT NOT NULL,
    "product_id" UUID,
    "supplier_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effective_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specification_parameter" (
    "id" UUID NOT NULL,
    "specification_id" UUID NOT NULL,
    "parameter_name" TEXT NOT NULL,
    "test_method" TEXT,
    "lower_limit" TEXT,
    "upper_limit" TEXT,
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "specification_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_acknowledgment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sop_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_acknowledged" INTEGER NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_acknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "retention_years" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessment" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source_record_type" TEXT,
    "source_record_id" UUID,
    "title" TEXT NOT NULL,
    "risk_method" TEXT NOT NULL DEFAULT 'risk_matrix_2x2',
    "severity" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "detectability" INTEGER,
    "score" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "mitigation_actions" TEXT,
    "capa_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "risk_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_company_id_idx" ON "supplier"("company_id");

-- CreateIndex
CREATE INDEX "equipment_company_id_idx" ON "equipment"("company_id");

-- CreateIndex
CREATE INDEX "equipment_facility_id_idx" ON "equipment"("facility_id");

-- CreateIndex
CREATE INDEX "sop_company_id_idx" ON "sop"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sop_company_id_document_number_current_version_key" ON "sop"("company_id", "document_number", "current_version");

-- CreateIndex
CREATE INDEX "specification_company_id_idx" ON "specification"("company_id");

-- CreateIndex
CREATE INDEX "specification_parameter_specification_id_idx" ON "specification_parameter"("specification_id");

-- CreateIndex
CREATE INDEX "document_acknowledgment_company_id_idx" ON "document_acknowledgment"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_acknowledgment_sop_id_user_id_version_acknowledged_key" ON "document_acknowledgment"("sop_id", "user_id", "version_acknowledged");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_company_id_record_type_key" ON "retention_policy"("company_id", "record_type");

-- CreateIndex
CREATE INDEX "risk_assessment_company_id_idx" ON "risk_assessment"("company_id");

-- CreateIndex
CREATE INDEX "risk_assessment_company_id_source_record_type_source_record_idx" ON "risk_assessment"("company_id", "source_record_type", "source_record_id");

-- CreateIndex
CREATE INDEX "capa_company_id_source_record_type_source_record_id_idx" ON "capa"("company_id", "source_record_type", "source_record_id");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop" ADD CONSTRAINT "sop_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop" ADD CONSTRAINT "sop_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop" ADD CONSTRAINT "sop_supersedes_document_id_fkey" FOREIGN KEY ("supersedes_document_id") REFERENCES "sop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop" ADD CONSTRAINT "sop_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification" ADD CONSTRAINT "specification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification" ADD CONSTRAINT "specification_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification" ADD CONSTRAINT "specification_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification" ADD CONSTRAINT "specification_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification_parameter" ADD CONSTRAINT "specification_parameter_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "specification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgment" ADD CONSTRAINT "document_acknowledgment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgment" ADD CONSTRAINT "document_acknowledgment_sop_id_fkey" FOREIGN KEY ("sop_id") REFERENCES "sop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgment" ADD CONSTRAINT "document_acknowledgment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessment" ADD CONSTRAINT "risk_assessment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessment" ADD CONSTRAINT "risk_assessment_capa_id_fkey" FOREIGN KEY ("capa_id") REFERENCES "capa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessment" ADD CONSTRAINT "risk_assessment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — every new tenant table, in this same migration
-- (never retrofitted). Seven of the eight carry `company_id` directly;
-- `specification_parameter` does not (only reachable via its parent
-- `specification`), so its policy joins back, the exact
-- `reg_dossier_document_slot` precedent.

ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "sop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sop" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sop"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "specification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "specification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "specification"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "specification_parameter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "specification_parameter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "specification_parameter"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "specification" s
      WHERE s.id = specification_parameter.specification_id
        AND s.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "specification" s
      WHERE s.id = specification_parameter.specification_id
        AND s.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );

ALTER TABLE "document_acknowledgment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_acknowledgment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_acknowledgment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "retention_policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "retention_policy"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "risk_assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_assessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "risk_assessment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
