-- VigiCloud Stage 3.5 (Hotline/Phone call-logging) + Stage 3.7
-- (mandatory source-document redacted-copy upload slot).
--
-- Note: the raw `prisma migrate diff` output this was hand-assembled
-- from also included `DropIndex` statements against
-- `audit_entry_occurred_at_brin_idx` and five hand-written trigram
-- indexes — the same known false positive that has recurred in every
-- migration this session (Prisma's schema diffing doesn't know about
-- indexes created via raw SQL outside its own `@@index`/`@@unique`
-- declarations). Deliberately not included here.

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('case_created', 'information_only', 'follow_up_required', 'unable_to_reach');

-- AlterTable
ALTER TABLE "pv_source_document" ADD COLUMN     "redacted_at" TIMESTAMP(3),
ADD COLUMN     "redacted_document_id" UUID;

-- CreateTable
CREATE TABLE "pv_call_log" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "caller_number" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "duration_seconds" INTEGER,
    "outcome" "CallOutcome" NOT NULL,
    "notes" TEXT,
    "case_id" UUID,
    "logged_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pv_call_log_company_id_occurred_at_idx" ON "pv_call_log"("company_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "pv_call_log" ADD CONSTRAINT "pv_call_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_call_log" ADD CONSTRAINT "pv_call_log_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_call_log" ADD CONSTRAINT "pv_call_log_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_source_document" ADD CONSTRAINT "pv_source_document_redacted_document_id_fkey" FOREIGN KEY ("redacted_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — pv_call_log is the only new tenant-owned table.
ALTER TABLE "pv_call_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_call_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_call_log"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
