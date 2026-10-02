-- CreateTable
CREATE TABLE "inspection_readiness_pack" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pdf_document_id" UUID NOT NULL,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_readiness_pack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inspection_readiness_pack_company_id_generated_at_idx" ON "inspection_readiness_pack"("company_id", "generated_at");

-- AddForeignKey
ALTER TABLE "inspection_readiness_pack" ADD CONSTRAINT "inspection_readiness_pack_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_readiness_pack" ADD CONSTRAINT "inspection_readiness_pack_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_readiness_pack" ADD CONSTRAINT "inspection_readiness_pack_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "inspection_readiness_pack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inspection_readiness_pack" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inspection_readiness_pack"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
