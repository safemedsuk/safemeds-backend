-- RegCloud (Phase 12) Stage 8/10/11 — Post-Market & Obligations,
-- Establishment/Premises & Personnel Licensing, Import/Export & Permits.
--
-- The 8 leading `DROP INDEX` statements Prisma's own diff proposed here
-- are spurious — they target real, hand-written BRIN/trigram indexes
-- (`audit_entry`'s BRIN index, six `pg_trgm` GIN indexes on
-- `product`/`meddra_term`/`who_drug_term`) that have no relationship to
-- this migration's actual schema change. Those indexes exist via raw SQL
-- in earlier migrations, not `schema.prisma`'s own `@@index` syntax, so
-- Prisma's diff engine — which can only compare against what's declared —
-- concludes they shouldn't exist. Stripped per this project's own
-- established discipline (see CLAUDE.md's gotchas list) rather than
-- applied verbatim.

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "licence_document_id" UUID,
ADD COLUMN     "licence_expires_on" DATE,
ADD COLUMN     "licence_issued_on" DATE,
ADD COLUMN     "licence_number" TEXT,
ADD COLUMN     "licence_status" TEXT;

-- CreateTable
CREATE TABLE "personnel_licence" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "licence_type" TEXT NOT NULL,
    "licence_number" TEXT NOT NULL,
    "issued_on" DATE NOT NULL,
    "expires_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "licence_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "personnel_licence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_post_market_obligation" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_registration_id" UUID NOT NULL,
    "obligation_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_post_market_obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_post_market_obligation_fulfillment" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "fulfilled_at" TIMESTAMPTZ(3) NOT NULL,
    "fulfilled_by" UUID,
    "evidence_document_id" UUID,
    "generated_report_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reg_post_market_obligation_fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_export_permit" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_registration_id" UUID,
    "authority_id" UUID NOT NULL,
    "permit_type" TEXT NOT NULL,
    "permit_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "valid_from" DATE,
    "valid_to" DATE,
    "permit_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_export_permit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personnel_licence_company_id_user_id_idx" ON "personnel_licence"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "reg_post_market_obligation_company_id_product_registration__idx" ON "reg_post_market_obligation"("company_id", "product_registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "reg_post_market_obligation_product_registration_id_obligati_key" ON "reg_post_market_obligation"("product_registration_id", "obligation_type");

-- CreateIndex
CREATE INDEX "reg_post_market_obligation_fulfillment_obligation_id_idx" ON "reg_post_market_obligation_fulfillment"("obligation_id");

-- CreateIndex
CREATE INDEX "import_export_permit_company_id_product_id_idx" ON "import_export_permit"("company_id", "product_id");

-- AddForeignKey
ALTER TABLE "facility" ADD CONSTRAINT "facility_licence_document_id_fkey" FOREIGN KEY ("licence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_licence" ADD CONSTRAINT "personnel_licence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_licence" ADD CONSTRAINT "personnel_licence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_licence" ADD CONSTRAINT "personnel_licence_licence_document_id_fkey" FOREIGN KEY ("licence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_licence" ADD CONSTRAINT "personnel_licence_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation" ADD CONSTRAINT "reg_post_market_obligation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation" ADD CONSTRAINT "reg_post_market_obligation_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation" ADD CONSTRAINT "reg_post_market_obligation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation_fulfillment" ADD CONSTRAINT "reg_post_market_obligation_fulfillment_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "reg_post_market_obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation_fulfillment" ADD CONSTRAINT "reg_post_market_obligation_fulfillment_fulfilled_by_fkey" FOREIGN KEY ("fulfilled_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation_fulfillment" ADD CONSTRAINT "reg_post_market_obligation_fulfillment_evidence_document_i_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_post_market_obligation_fulfillment" ADD CONSTRAINT "reg_post_market_obligation_fulfillment_generated_report_id_fkey" FOREIGN KEY ("generated_report_id") REFERENCES "generated_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_permit_document_id_fkey" FOREIGN KEY ("permit_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_export_permit" ADD CONSTRAINT "import_export_permit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Real Postgres RLS, built in from the start (not retroactively) — per
-- this project's own established discipline since the Stage 0.6
-- RLS-hardening pass. `personnel_licence` and `import_export_permit`
-- carry `company_id` directly, same template as every other tenant
-- table. `reg_post_market_obligation_fulfillment` has no `company_id`
-- of its own (only reachable via its parent `reg_post_market_obligation`)
-- — same EXISTS-subquery shape already established for
-- `reg_dossier_document_slot`/`document_version`.

ALTER TABLE "personnel_licence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "personnel_licence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "personnel_licence"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_post_market_obligation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_post_market_obligation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_post_market_obligation"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "import_export_permit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_export_permit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_export_permit"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_post_market_obligation_fulfillment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_post_market_obligation_fulfillment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_post_market_obligation_fulfillment"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "reg_post_market_obligation" o
      WHERE o.id = reg_post_market_obligation_fulfillment.obligation_id
        AND o.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "reg_post_market_obligation" o
      WHERE o.id = reg_post_market_obligation_fulfillment.obligation_id
        AND o.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );
