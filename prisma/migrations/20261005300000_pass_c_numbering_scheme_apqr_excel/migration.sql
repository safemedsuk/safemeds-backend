-- QualCloud Phase 2 Pass C: admin-configurable document numbering scheme
-- and the Excel archive pointer on the APQR (Pqr). Hand-written; no
-- spurious DROP INDEX statements.

CREATE TABLE "document_numbering_scheme" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "initials" TEXT,
    "token_order" JSONB,
    "separator" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_numbering_scheme_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_numbering_scheme_company_id_scope_key"
    ON "document_numbering_scheme"("company_id", "scope");

ALTER TABLE "document_numbering_scheme"
    ADD CONSTRAINT "document_numbering_scheme_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_numbering_scheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_numbering_scheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_numbering_scheme"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "pqr" ADD COLUMN "excel_generated_report_id" UUID;

ALTER TABLE "pqr"
    ADD CONSTRAINT "pqr_excel_generated_report_id_fkey"
    FOREIGN KEY ("excel_generated_report_id") REFERENCES "generated_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
