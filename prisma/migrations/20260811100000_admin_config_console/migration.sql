-- Admin Configuration Console — plain-text citation fields, additive only.
-- AlterTable
ALTER TABLE "audit_requirement_definition" ADD COLUMN     "guideline_reference" TEXT;

-- AlterTable
ALTER TABLE "reporting_rule" ADD COLUMN     "source_reference" TEXT;
