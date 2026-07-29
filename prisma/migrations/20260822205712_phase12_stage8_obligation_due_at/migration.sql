-- RegCloud (Phase 12) Stage 8 — `reg_post_market_obligation` gets its own
-- direct `dueAt`/`notifiedOverdueAt` ledger fields (mirroring
-- `RegFeeInvoice`'s own precedent) rather than a linked `RegDeadline` row
-- — see the model's own schema doc comment for the full reasoning. The
-- table is brand new (created moments ago in the prior migration this
-- same session, still empty), so a required NOT NULL column addition is
-- safe with no backfill needed.
--
-- The 8 leading `DROP INDEX` statements Prisma's own diff proposed here
-- are the same recurring spurious ones this project's migrations keep
-- hitting (real hand-written BRIN/trigram indexes Prisma's schema-only
-- diff can't see) — stripped per established discipline, see CLAUDE.md's
-- gotchas list.

-- AlterTable
ALTER TABLE "reg_post_market_obligation" ADD COLUMN     "due_at" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "notified_overdue_at" TIMESTAMPTZ(3);
