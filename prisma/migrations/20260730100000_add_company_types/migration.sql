-- Adds 4 new CompanyType values alongside the existing 4 (not replacing
-- them) — self-service registration category for medical facilities,
-- NGO/social-health orgs, research institutions, and an open "other".

ALTER TYPE "CompanyType" ADD VALUE 'medical_facility';
ALTER TYPE "CompanyType" ADD VALUE 'ngo_social_health';
ALTER TYPE "CompanyType" ADD VALUE 'research_institution';
ALTER TYPE "CompanyType" ADD VALUE 'other';
