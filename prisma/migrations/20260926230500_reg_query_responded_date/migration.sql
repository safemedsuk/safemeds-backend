-- testing-correction-explanation.md §2.1 — the real date a query response
-- was sent to the regulator, distinct from the system's own `responded_at`
-- timestamp. Nullable, purely additive; the raw `prisma migrate diff`
-- output for this change also proposed 8 spurious `DROP INDEX` statements
-- against real hand-written BRIN/trigram indexes it doesn't know about —
-- stripped here, per this project's own established discipline.

ALTER TABLE "reg_query" ADD COLUMN "responded_date" DATE;
