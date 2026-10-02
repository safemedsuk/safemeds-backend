-- testing-correction-explanation.md decision #4 — "every company MUST
-- have an email address." Nullable, purely additive; the usual 8 spurious
-- DROP INDEX statements stripped per this project's own established
-- discipline.

ALTER TABLE "company_registration" ADD COLUMN "company_email" TEXT;
