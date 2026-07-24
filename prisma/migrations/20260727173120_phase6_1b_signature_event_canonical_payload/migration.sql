/*
  Warnings:

  - Added the required column `canonical_payload` to the `signature_event` table without a default value. This is not possible if the table is not empty.

*/
-- NOTE: as in prior phase 5/6 migrations, deliberately NOT dropping
-- audit_entry_occurred_at_brin_idx — real Phase 3.1 infrastructure, not
-- Prisma-representable, not drift.

-- AlterTable
ALTER TABLE "signature_event" ADD COLUMN     "canonical_payload" JSONB NOT NULL;
