-- Phase 8 — Documents & Storage. `prisma migrate diff` also wants to drop
-- audit_entry's BRIN index and the three pg_trgm indexes (product/registration/
-- meddra_term name search) — that's the same recurring false-positive drift
-- Prisma's DSL can't express raw-SQL indexes it didn't create; deliberately
-- NOT included here, same as every prior migration that hit this.

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('pending', 'stored', 'failed');

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT,
    "size_bytes" INTEGER,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'pending',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_company_id_record_type_record_id_idx" ON "document"("company_id", "record_type", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_document_id_version_key" ON "document_version"("document_id", "version");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — `document` is tenant-scoped (company_id), same template as every
-- other tenant table. `document_version` has no company_id of its own
-- (only reachable via its parent `document`), so its policy joins back to
-- `document` rather than duplicating the company_id column onto every
-- version row.
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "document_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_version"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "document" d
      WHERE d.id = document_version.document_id
        AND d.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "document" d
      WHERE d.id = document_version.document_id
        AND d.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );
