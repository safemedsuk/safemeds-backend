-- RegCloud (Phase 12) Stage 10/11 — never-re-flag "already reminded"
-- guards for the 90-day approaching-renewal reminder, matching
-- `RegFeeInvoice.notifiedOverdueAt`'s own precedent, added just before
-- `RegLicensingExpiryService`'s first use (see that service's own doc
-- comment for why this doesn't route through `RegDeadline`).
--
-- The 8 leading `DROP INDEX` statements Prisma's own diff proposed here
-- are the same recurring spurious ones this project's migrations keep
-- hitting (real hand-written BRIN/trigram indexes Prisma's schema-only
-- diff can't see) — stripped per established discipline, see CLAUDE.md's
-- gotchas list.

-- AlterTable
ALTER TABLE "facility" ADD COLUMN     "licence_renewal_notified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "import_export_permit" ADD COLUMN     "renewal_notified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "personnel_licence" ADD COLUMN     "renewal_notified_at" TIMESTAMPTZ(3);
