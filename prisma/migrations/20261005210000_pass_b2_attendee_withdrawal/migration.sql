-- QualCloud Phase 1 Pass B (follow-up) — attendees are withdrawn, never deleted.
-- Hand-written; no spurious DROP INDEX statements.
ALTER TABLE "waste_disposal_case_attendee" ADD COLUMN "withdrawn_at" TIMESTAMPTZ(3);
ALTER TABLE "management_review_attendee" ADD COLUMN "withdrawn_at" TIMESTAMPTZ(3);
