-- Phase 3.1 — Audit substrate hardening.
--
-- `audit_entry` is append-only by application convention already
-- (`AuditService.log()` only ever calls `.create()`). This migration makes
-- that a database-enforced guarantee, not just a code convention, and adds
-- the time-range index the query endpoints in 3.2 rely on.

-- BRIN index on occurred_at: audit_entry is append-only and physically
-- insert-ordered by time, which is exactly what a BRIN index is built for —
-- a few KB even at millions of rows, vs a much larger btree, for range scans
-- like "everything in the last 30 days" (GET /audit's from/to filters).
CREATE INDEX "audit_entry_occurred_at_brin_idx" ON "audit_entry" USING BRIN ("occurred_at");

-- Belt-and-braces #1: revoke UPDATE/DELETE from the application's own
-- connecting role. NOTE — this deployment has a single, non-superuser
-- Postgres role (`safemeds`) that both owns every table and is what the app
-- connects as. Unlike Row-Level Security (where an owning role bypasses
-- policies unless FORCE is set), plain table-owner privileges are just an
-- implicit grant that an explicit REVOKE genuinely revokes even for the
-- owner — confirmed live: after this REVOKE, `safemeds` itself gets
-- `permission denied for table audit_entry` on UPDATE/DELETE. So this is
-- the real, primary enforcement here, not just documentation of intent.
REVOKE UPDATE, DELETE ON "audit_entry" FROM "safemeds";

-- Belt-and-braces #2: a trigger raising an exception on any UPDATE or
-- DELETE attempt, so a future Postgres superuser session (which bypasses
-- ACL checks entirely, including the REVOKE above) still can't silently
-- rewrite history.
CREATE OR REPLACE FUNCTION audit_entry_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entry is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_entry_no_update
  BEFORE UPDATE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_immutable();

CREATE TRIGGER audit_entry_no_delete
  BEFORE DELETE ON "audit_entry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_immutable();
