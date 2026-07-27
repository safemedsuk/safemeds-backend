-- VigiCloud Phase 11 Stage 11 corrective migration — `pv_case_follow_up.started_by`
-- needs to be nullable: a follow-up cycle can be system-triggered (the
-- periodic job auto-starting one off a `PregnancyContext.followUpDueAt`
-- that's come due, with no human actor involved), mirroring the exact
-- precedent already set for `Case.createdBy`/`Document.createdBy` on a
-- system-originated record with nobody to attribute it to. Written as a
-- fresh, additive migration rather than editing the just-applied
-- `20260809100000_...` migration in place, per this repo's standing rule
-- to never edit a migration once `migrate deploy` has run against a real
-- database.

-- AlterTable
ALTER TABLE "pv_case_follow_up" ALTER COLUMN "started_by" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "pv_case_follow_up" DROP CONSTRAINT "pv_case_follow_up_started_by_fkey";

-- AddForeignKey
ALTER TABLE "pv_case_follow_up" ADD CONSTRAINT "pv_case_follow_up_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
