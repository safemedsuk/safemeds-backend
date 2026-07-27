-- VigiCloud Phase 11, Stage 16 — Governance & Audit Module.
-- Adds: psmf (16.1), audit_requirement_definition + audit_requirement_record
-- + audit_pack (16.2), internal_audit + audit_finding + capa (16.3),
-- qppv_nomination + company.primary/backup_qppv_user_id (16.4), sdea (16.5),
-- training_record (16.6).
--
-- Generated via `prisma migrate diff` against the shadow database, then
-- hand-edited: the 8 known-false-positive `DROP INDEX` statements for
-- `audit_entry_occurred_at_brin_idx` and the 7 pg_trgm indexes (created via
-- raw SQL in earlier migrations, invisible to Prisma's own introspection,
-- and NOT touched here) were stripped, exactly like every prior stage's
-- migration in this repo. A hand-added partial unique index enforces
-- "one active PSMF per company" (`psmf_one_active_per_company`), matching
-- `reporting_rule_one_active_per_key`'s own precedent from Phase 4.1 —
-- Prisma's schema language cannot express a partial index. RLS
-- ENABLE/FORCE/CREATE POLICY blocks are appended by hand for every new
-- tenant-owned table; `audit_requirement_definition` is deliberately
-- excluded — it's global reference/seed data (mirrors `MeddraTerm`/
-- `WhoDrugTerm`), not per-company data.

-- CreateEnum
CREATE TYPE "PsmfStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "AuditRequirementSource" AS ENUM ('system_generated', 'person_uploads');

-- CreateEnum
CREATE TYPE "AuditRequirementStatus" AS ENUM ('ready', 'needs_update', 'expiring', 'missing');

-- CreateEnum
CREATE TYPE "InternalAuditStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditFindingSeverity" AS ENUM ('critical', 'major', 'minor', 'observation');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('open', 'capa_assigned', 'closed');

-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('open', 'in_progress', 'pending_effectiveness_check', 'closed');

-- CreateEnum
CREATE TYPE "CapaEffectivenessResult" AS ENUM ('effective', 'not_effective');

-- CreateEnum
CREATE TYPE "QppvNominationRole" AS ENUM ('primary', 'backup');

-- CreateEnum
CREATE TYPE "QppvNominationStatus" AS ENUM ('active', 'superseded');

-- CreateEnum
CREATE TYPE "SdeaStatus" AS ENUM ('draft', 'active', 'expired', 'superseded');

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "backup_qppv_user_id" UUID,
ADD COLUMN     "primary_qppv_user_id" UUID;

-- CreateTable
CREATE TABLE "psmf" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PsmfStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),

    CONSTRAINT "psmf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_requirement_definition" (
    "id" UUID NOT NULL,
    "authority_id" UUID NOT NULL,
    "requirement_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" "AuditRequirementSource" NOT NULL,
    "evidence_artifact_type" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_requirement_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_requirement_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "status" "AuditRequirementStatus" NOT NULL DEFAULT 'missing',
    "evidence_document_id" UUID,
    "checklist_json" JSONB,
    "note" TEXT,
    "last_verified_at" TIMESTAMPTZ(3),
    "next_due_at" TIMESTAMPTZ(3),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_requirement_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_pack" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "pdf_document_id" UUID NOT NULL,
    "generated_by" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_audit" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "scheduled_date" DATE NOT NULL,
    "status" "InternalAuditStatus" NOT NULL DEFAULT 'scheduled',
    "lead_auditor_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "internal_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "AuditFindingSeverity" NOT NULL,
    "status" "AuditFindingStatus" NOT NULL DEFAULT 'open',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capa" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "finding_id" UUID,
    "title" TEXT NOT NULL,
    "corrective_action" TEXT NOT NULL,
    "preventive_action" TEXT,
    "owner_user_id" UUID,
    "due_date" DATE,
    "status" "CapaStatus" NOT NULL DEFAULT 'open',
    "effectiveness_check_due_at" TIMESTAMPTZ(3),
    "effectiveness_checked_at" TIMESTAMPTZ(3),
    "effectiveness_checked_by" UUID,
    "effectiveness_check_result" "CapaEffectivenessResult",
    "effectiveness_check_note" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "capa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qppv_nomination" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "qppv_user_id" UUID NOT NULL,
    "role" "QppvNominationRole" NOT NULL,
    "status" "QppvNominationStatus" NOT NULL DEFAULT 'active',
    "nomination_letter_document_id" UUID,
    "regulator_confirmation_document_id" UUID,
    "nominated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(3),
    "created_by" UUID,

    CONSTRAINT "qppv_nomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sdea" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty_name" TEXT NOT NULL,
    "template_used" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SdeaStatus" NOT NULL DEFAULT 'draft',
    "document_id" UUID,
    "effective_date" DATE,
    "expiry_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "training_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completion_date" DATE NOT NULL,
    "expiry_date" DATE,
    "certificate_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "psmf_company_id_status_idx" ON "psmf"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "psmf_company_id_version_key" ON "psmf"("company_id", "version");

-- Partial unique index — "one active PSMF per company", matching
-- `reporting_rule_one_active_per_key`'s own precedent (Phase 4.1);
-- Prisma's schema language cannot express a partial index directly.
CREATE UNIQUE INDEX "psmf_one_active_per_company"
  ON "psmf" ("company_id")
  WHERE "status" = 'active';

-- CreateIndex
CREATE UNIQUE INDEX "audit_requirement_definition_authority_id_requirement_key_key" ON "audit_requirement_definition"("authority_id", "requirement_key");

-- CreateIndex
CREATE UNIQUE INDEX "audit_requirement_record_company_id_definition_id_key" ON "audit_requirement_record"("company_id", "definition_id");

-- CreateIndex
CREATE INDEX "audit_pack_company_id_generated_at_idx" ON "audit_pack"("company_id", "generated_at");

-- CreateIndex
CREATE INDEX "internal_audit_company_id_scheduled_date_idx" ON "internal_audit"("company_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "audit_finding_company_id_audit_id_idx" ON "audit_finding"("company_id", "audit_id");

-- CreateIndex
CREATE INDEX "capa_company_id_status_idx" ON "capa"("company_id", "status");

-- CreateIndex
CREATE INDEX "qppv_nomination_company_id_role_status_idx" ON "qppv_nomination"("company_id", "role", "status");

-- CreateIndex
CREATE INDEX "sdea_company_id_distributor_id_status_idx" ON "sdea"("company_id", "distributor_id", "status");

-- CreateIndex
CREATE INDEX "training_record_company_id_user_id_idx" ON "training_record"("company_id", "user_id");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_primary_qppv_user_id_fkey" FOREIGN KEY ("primary_qppv_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_backup_qppv_user_id_fkey" FOREIGN KEY ("backup_qppv_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psmf" ADD CONSTRAINT "psmf_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psmf" ADD CONSTRAINT "psmf_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "psmf" ADD CONSTRAINT "psmf_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_requirement_definition" ADD CONSTRAINT "audit_requirement_definition_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "regulatory_authority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_requirement_record" ADD CONSTRAINT "audit_requirement_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_requirement_record" ADD CONSTRAINT "audit_requirement_record_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "audit_requirement_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_requirement_record" ADD CONSTRAINT "audit_requirement_record_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_requirement_record" ADD CONSTRAINT "audit_requirement_record_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_pack" ADD CONSTRAINT "audit_pack_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_pack" ADD CONSTRAINT "audit_pack_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_pack" ADD CONSTRAINT "audit_pack_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit" ADD CONSTRAINT "internal_audit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit" ADD CONSTRAINT "internal_audit_lead_auditor_user_id_fkey" FOREIGN KEY ("lead_auditor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit" ADD CONSTRAINT "internal_audit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "internal_audit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "audit_finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_effectiveness_checked_by_fkey" FOREIGN KEY ("effectiveness_checked_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capa" ADD CONSTRAINT "capa_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qppv_nomination" ADD CONSTRAINT "qppv_nomination_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qppv_nomination" ADD CONSTRAINT "qppv_nomination_qppv_user_id_fkey" FOREIGN KEY ("qppv_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qppv_nomination" ADD CONSTRAINT "qppv_nomination_nomination_letter_document_id_fkey" FOREIGN KEY ("nomination_letter_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qppv_nomination" ADD CONSTRAINT "qppv_nomination_regulator_confirmation_document_id_fkey" FOREIGN KEY ("regulator_confirmation_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qppv_nomination" ADD CONSTRAINT "qppv_nomination_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdea" ADD CONSTRAINT "sdea_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdea" ADD CONSTRAINT "sdea_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdea" ADD CONSTRAINT "sdea_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdea" ADD CONSTRAINT "sdea_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_certificate_document_id_fkey" FOREIGN KEY ("certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_record" ADD CONSTRAINT "training_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — tenant-owned.
ALTER TABLE "psmf" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "psmf" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "psmf"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "audit_requirement_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_requirement_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_requirement_record"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "audit_pack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_pack" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_pack"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "internal_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "internal_audit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "internal_audit"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "audit_finding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_finding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_finding"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "capa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "capa" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "capa"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "qppv_nomination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qppv_nomination" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "qppv_nomination"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "sdea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sdea" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sdea"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Row-Level Security — tenant-owned.
ALTER TABLE "training_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "training_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "training_record"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
