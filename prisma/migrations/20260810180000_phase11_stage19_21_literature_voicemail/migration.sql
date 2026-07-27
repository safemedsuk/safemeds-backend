-- VigiCloud Phase 11 Stage 19 (Literature Monitoring) + Stage 21
-- (Voicemail / Missed-Call Logging). Hand-written from `prisma migrate
-- diff`'s raw output — the diff's own 8 DropIndex statements (audit_entry's
-- BRIN index + the 7 pg_trgm indexes on product/registration/meddra_term/
-- who_drug_term) are the same known false positive documented in
-- CLAUDE.md's gotchas list and have been stripped here.

-- AlterTable: Stage 21 — voicemail/missed-call fields on CallLog
ALTER TABLE "pv_call_log" ADD COLUMN     "audio_document_id" UUID,
ADD COLUMN     "is_voicemail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transcription_note_encrypted" TEXT;

-- CreateTable: Stage 19 — manually-logged literature screening events
CREATE TABLE "pv_literature_monitoring_run" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_at" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT NOT NULL,
    "search_terms" TEXT NOT NULL,
    "hits_count" INTEGER NOT NULL,
    "hits_summary" TEXT,
    "logged_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_literature_monitoring_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pv_literature_monitoring_run_company_id_run_at_idx" ON "pv_literature_monitoring_run"("company_id", "run_at");

-- AddForeignKey
ALTER TABLE "pv_call_log" ADD CONSTRAINT "pv_call_log_audio_document_id_fkey" FOREIGN KEY ("audio_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_literature_monitoring_run" ADD CONSTRAINT "pv_literature_monitoring_run_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_literature_monitoring_run" ADD CONSTRAINT "pv_literature_monitoring_run_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — pv_literature_monitoring_run is the only new tenant-owned table (pv_call_log already had RLS applied when it was created, Stage 3.5).
ALTER TABLE "pv_literature_monitoring_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_literature_monitoring_run" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pv_literature_monitoring_run"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
