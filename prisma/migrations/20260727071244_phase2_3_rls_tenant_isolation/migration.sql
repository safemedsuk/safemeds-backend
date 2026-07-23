-- Phase 2.3 — Postgres Row-Level Security
--
-- Applied to app_user, security_policy, invitation: the tenant-owned
-- tables actually reachable via a "list/get scoped to my company" query
-- pattern today. FORCE means even the table owner (the app's own DB role)
-- is subject to these policies — there is no bypass except the explicit,
-- audited `app.bypass_rls` session flag set by RlsService.
--
-- Two session variables drive the policy, set via `SELECT set_config(...)`
-- inside a transaction (`SET LOCAL` semantics — cleared at commit/rollback,
-- never leaks between requests sharing a pooled connection):
--   app.company_id  — the acting tenant user's company (uuid, as text)
--   app.bypass_rls  — 'true' for the narrow set of pre-authentication
--                     system lookups (resolve identity by email/token
--                     before any company is known) and audited platform
--                     cross-tenant reads. Every use lives in RlsService —
--                     grep-able, not ad-hoc.
--
-- Fail-closed by construction: an ordinary query that "forgets" a
-- company_id where-clause, or runs outside RlsService entirely (so
-- neither session var is set), sees zero rows — never another company's
-- data. That's the property the Phase 2.3 e2e proof test checks.

ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "app_user"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "security_policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security_policy" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "security_policy"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "invitation"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
