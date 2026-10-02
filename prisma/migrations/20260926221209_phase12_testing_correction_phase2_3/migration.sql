-- testing-correction-explanation.md Phase 2/3 — Variation types (real enum),
-- Variation/Renewal display codes, Variation-Application/approval document
-- slots, Retention, and Withdrawal-with-evidence.
--
-- Hand-written, not `prisma migrate dev`'s raw output — that output (kept
-- for reference in this session's own scratch history) both proposed 8
-- spurious `DROP INDEX` statements against real hand-written BRIN/trigram
-- indexes it doesn't know about (the same class of gap this project's own
-- CLAUDE.md gotchas list already documents — stripped entirely here) and,
-- more seriously, a `DROP COLUMN "variation_type" / ADD COLUMN ... NOT NULL`
-- pair for the enum conversion that would have silently destroyed every
-- real `reg_variation.variation_type` value in this database (5 real rows
-- exist, confirmed via a direct query before writing this file) rather
-- than converting it. Rewritten below as an additive, data-preserving
-- sequence instead.

-- `reg_variation`/`product_registration` both carry `FORCE ROW LEVEL
-- SECURITY` — even the table owner (which is who runs a migration) sees
-- zero rows without this, per this project's own established gotcha.
-- Scoped to this migration's own transaction only (`SET LOCAL`), not a
-- session-wide change.
SET LOCAL app.bypass_rls = 'true';

-- CreateEnum
CREATE TYPE "RegVariationType" AS ENUM ('minor', 'major', 'immediate_notification', 'yearly_notification', 'renewal');

-- AlterTable — ProductRegistration: withdrawal fields (all nullable, purely additive).
ALTER TABLE "product_registration"
  ADD COLUMN "withdrawal_document_id" UUID,
  ADD COLUMN "withdrawn_at" TIMESTAMPTZ(3),
  ADD COLUMN "withdrawn_by" UUID,
  ADD COLUMN "withdrawn_reason" TEXT;

-- AlterTable — RegDossier: the 3 approval-time document slots (all nullable, purely additive).
ALTER TABLE "reg_dossier"
  ADD COLUMN "approval_evidence_document_id" UUID,
  ADD COLUMN "approval_invoice_document_id" UUID,
  ADD COLUMN "approval_payment_proof_document_id" UUID;

-- AlterTable — RegVariation: new nullable columns first (display_code is
-- added nullable, backfilled below, then made NOT NULL — never NOT NULL
-- from the start against a table with real existing rows).
ALTER TABLE "reg_variation"
  ADD COLUMN "display_code" TEXT,
  ADD COLUMN "invoice_document_id" UUID,
  ADD COLUMN "payment_proof_document_id" UUID;

-- Backfill display_code for every existing row (5 in the current dev
-- database, but written generically — a no-op on an empty table, and
-- correct on any other database's real accumulated rows too). Two
-- independent per-company sequences, ordered by created_at: REN- for a
-- 'renewal' row, VAR- for everything else — matching
-- RegVariationService's own live numbering scheme exactly, so a
-- backfilled historical row's display code looks exactly like one the
-- service would have generated itself.
WITH numbered AS (
  SELECT
    rv.id,
    (rv.variation_type = 'renewal') AS is_renewal,
    ROW_NUMBER() OVER (
      PARTITION BY rv.company_id, (rv.variation_type = 'renewal')
      ORDER BY rv.created_at
    ) AS seq,
    pr.registration_number
  FROM "reg_variation" rv
  JOIN "product_registration" pr ON pr.id = rv.product_registration_id
)
UPDATE "reg_variation"
SET "display_code" = (CASE WHEN numbered.is_renewal THEN 'REN-' ELSE 'VAR-' END)
  || LPAD(numbered.seq::text, 5, '0')
  || '-' || numbered.registration_number
FROM numbered
WHERE "reg_variation".id = numbered.id;

ALTER TABLE "reg_variation" ALTER COLUMN "display_code" SET NOT NULL;

-- Real pre-existing test data carries one variation_type value
-- ('labeling_change') outside the now-confirmed 4-category list
-- (minor/major/immediate_notification/yearly_notification) — the
-- real-world equivalent of a labeling change is standardly filed as a
-- minor variation, so it's mapped there before the type conversion below
-- rather than left to fail the cast or silently dropped.
UPDATE "reg_variation" SET "variation_type" = 'minor' WHERE "variation_type" = 'labeling_change';

-- Data-preserving type change: every real existing value (only 'renewal'
-- and, as of the UPDATE above, 'minor') casts cleanly onto the new enum —
-- never a DROP COLUMN.
ALTER TABLE "reg_variation"
  ALTER COLUMN "variation_type" TYPE "RegVariationType"
  USING "variation_type"::"RegVariationType";

-- CreateTable — RegRetention (brand new, no existing data).
CREATE TABLE "reg_retention" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_registration_id" UUID NOT NULL,
    "display_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "invoice_document_id" UUID NOT NULL,
    "proof_of_payment_document_id" UUID NOT NULL,
    "certificate_document_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paid_at" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_retention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reg_retention_company_id_product_registration_id_idx" ON "reg_retention"("company_id", "product_registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "reg_retention_company_id_display_code_key" ON "reg_retention"("company_id", "display_code");

-- CreateIndex
CREATE UNIQUE INDEX "reg_retention_product_registration_id_year_key" ON "reg_retention"("product_registration_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "reg_variation_company_id_display_code_key" ON "reg_variation"("company_id", "display_code");

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_withdrawn_by_fkey" FOREIGN KEY ("withdrawn_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_registration" ADD CONSTRAINT "product_registration_withdrawal_document_id_fkey" FOREIGN KEY ("withdrawal_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_approval_payment_proof_document_id_fkey" FOREIGN KEY ("approval_payment_proof_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_approval_invoice_document_id_fkey" FOREIGN KEY ("approval_invoice_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_dossier" ADD CONSTRAINT "reg_dossier_approval_evidence_document_id_fkey" FOREIGN KEY ("approval_evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_payment_proof_document_id_fkey" FOREIGN KEY ("payment_proof_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_variation" ADD CONSTRAINT "reg_variation_invoice_document_id_fkey" FOREIGN KEY ("invoice_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_invoice_document_id_fkey" FOREIGN KEY ("invoice_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_proof_of_payment_document_id_fkey" FOREIGN KEY ("proof_of_payment_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_certificate_document_id_fkey" FOREIGN KEY ("certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_retention" ADD CONSTRAINT "reg_retention_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
