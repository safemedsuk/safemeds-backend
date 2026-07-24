-- Multi-market / multi-location tenancy: RLS on `company_market` and
-- `facility`, same template as phase2_3/phase5_1/phase7_1. Both tables
-- existed since Phase 4.1 but were never given RLS — closed here as part
-- of building the company-markets/facility management feature.

ALTER TABLE "company_market" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_market" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_market"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "facility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facility" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "facility"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
