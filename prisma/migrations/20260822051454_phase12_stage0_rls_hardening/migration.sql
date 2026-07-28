-- RegCloud (Phase 12) Stage 0.6 — Cross-Module Joins & Access Scoping.
--
-- A real gap found by this stage's own "confirm every new table RLS-scopes
-- correctly" audit: every Stage 0.1–0.4 tenant-owned table was already
-- correctly scoped at the *application* layer (`RlsService.runAsCompany()`
-- plus an explicit `companyId` in every service's own `where` clause), but
-- none of them had real Postgres-level `FORCE ROW LEVEL SECURITY` — the
-- database-level backstop every other tenant table in this schema has had
-- since Phase 2.3/7.1/8 (a policy that saves a future service method that
-- forgets its own `where: { companyId }` filter, not something the
-- application layer can self-certify). This migration closes that gap for
-- every tenant-owned table Stage 0 introduced. It intentionally does NOT
-- touch `regulatory_requirement`/`required_document_definition`/
-- `regulatory_fee_schedule`/`reg_deadline_rule` — those are global,
-- platform-wide config with no `company_id` at all, exactly like
-- `reporting_rule`/`seriousness_definition` before them, so no RLS applies.

-- `manufacturer`, `manufacturing_site`, `local_representative`, `reg_dossier`,
-- `reg_deadline` all carry `company_id` directly — same template as
-- `product`/`product_registration` (Phase 7.1).
ALTER TABLE "manufacturer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "manufacturer"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "manufacturing_site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "manufacturing_site" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "manufacturing_site"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "local_representative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "local_representative" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "local_representative"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_dossier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_dossier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_dossier"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_deadline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_deadline" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_deadline"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- `reg_dossier_document_slot` has no `company_id` of its own (only
-- reachable via its parent `reg_dossier`) — same shape as
-- `document_version` (Phase 8), so its policy joins back to `reg_dossier`
-- rather than duplicating the column onto every slot row.
ALTER TABLE "reg_dossier_document_slot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_dossier_document_slot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_dossier_document_slot"
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "reg_dossier" d
      WHERE d.id = reg_dossier_document_slot.reg_dossier_id
        AND d.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "reg_dossier" d
      WHERE d.id = reg_dossier_document_slot.reg_dossier_id
        AND d.company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    )
  );
