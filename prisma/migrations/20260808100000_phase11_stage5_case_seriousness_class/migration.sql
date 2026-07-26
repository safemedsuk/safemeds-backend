-- VigiCloud Stage 5 (Triage & Seriousness) — Case.seriousnessClass,
-- set by TriageService.classify().
--
-- Note: the raw `prisma migrate diff` output this was hand-assembled
-- from also included `DropIndex` statements against
-- `audit_entry_occurred_at_brin_idx` and five hand-written trigram
-- indexes — the same known false positive that has recurred in every
-- migration this session (Prisma's schema diffing doesn't know about
-- indexes created via raw SQL outside its own `@@index`/`@@unique`
-- declarations). Deliberately not included here.

-- AlterTable
ALTER TABLE "pv_case" ADD COLUMN     "seriousness_class" TEXT;
