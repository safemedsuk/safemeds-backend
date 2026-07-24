-- Adds a fourth platform role for the field/regulatory domain expert,
-- scoped to config-write + audit/records read only — see
-- safemeds-platform-roles.md for why super_admin was too broad for this
-- person. Additive enum value, no data migration needed.
ALTER TYPE "PlatformRole" ADD VALUE 'regulatory_lead';
