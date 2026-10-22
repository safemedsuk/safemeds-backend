-- QualCloud Phase 1 Pass A2 — CAPA allocation (owner/due dates/root cause/
-- regulatory approver) and investigation-due reminder stage.
-- Hand-written; no spurious DROP INDEX statements.

ALTER TABLE "capa"
    ADD COLUMN "root_cause" TEXT,
    ADD COLUMN "corrective_action_due_date" DATE,
    ADD COLUMN "preventive_action_due_date" DATE,
    ADD COLUMN "regulatory_approver_user_id" UUID;

-- Backfill: the legacy single due date becomes the corrective action due date
-- (the only due date that existed before), and the preventive one only where a
-- preventive action was actually recorded.
UPDATE "capa" SET "corrective_action_due_date" = "due_date" WHERE "due_date" IS NOT NULL;
UPDATE "capa" SET "preventive_action_due_date" = "due_date"
    WHERE "due_date" IS NOT NULL AND "preventive_action" IS NOT NULL AND "preventive_action" <> '';

ALTER TABLE "capa"
    ADD CONSTRAINT "capa_regulatory_approver_user_id_fkey"
    FOREIGN KEY ("regulatory_approver_user_id") REFERENCES "app_user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deviation"
    ADD COLUMN "investigation_reminder_stage" TEXT;
