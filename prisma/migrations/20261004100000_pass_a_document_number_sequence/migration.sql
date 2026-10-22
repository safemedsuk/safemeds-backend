-- QualCloud Phase 1 Pass A: server-generated controlled-document numbers.
-- Hand-written; no spurious DROP INDEX statements.
CREATE TABLE "document_number_sequence" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_number_sequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_number_sequence_company_id_document_type_year_key"
    ON "document_number_sequence"("company_id", "document_type", "year");

ALTER TABLE "document_number_sequence"
    ADD CONSTRAINT "document_number_sequence_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_number_sequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_number_sequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_number_sequence"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
