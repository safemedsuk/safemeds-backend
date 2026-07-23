-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('pending', 'met', 'missed', 'recalculated');

-- NOTE: Prisma's schema-diff engine wants to `DROP INDEX
-- "audit_entry_occurred_at_brin_idx"` here because that BRIN index was
-- created by hand-written raw SQL in the phase3_1_audit_immutability
-- migration and isn't representable via a Prisma `@@index` (Prisma has no
-- BRIN index type) — it's real, load-bearing infrastructure (Phase 3.1's
-- append-only audit_entry scan performance), not drift. Deliberately
-- dropped from this migration; never let a future `migrate dev` diff
-- silently remove it again.

-- CreateTable
CREATE TABLE "workflow_definition" (
    "id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "report_type_id" UUID,
    "country_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ConfigStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_state" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "state_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_initial" BOOLEAN NOT NULL DEFAULT false,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workflow_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_transition" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "from_state_id" UUID NOT NULL,
    "to_state_id" UUID NOT NULL,
    "required_role_id" UUID NOT NULL,
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workflow_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instance" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "current_state_id" UUID NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "workflow_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "reporting_rule_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'pending',
    "t72_notified_at" TIMESTAMP(3),
    "t24_notified_at" TIMESTAMP(3),
    "breached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_state_definition_id_state_key_key" ON "workflow_state"("definition_id", "state_key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_transition_definition_id_from_state_id_to_state_id_key" ON "workflow_transition"("definition_id", "from_state_id", "to_state_id");

-- CreateIndex
CREATE INDEX "workflow_instance_definition_id_idx" ON "workflow_instance"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instance_record_type_record_id_key" ON "workflow_instance"("record_type", "record_id");

-- CreateIndex
CREATE INDEX "deadline_company_id_status_due_at_idx" ON "deadline"("company_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "deadline_record_type_record_id_key" ON "deadline"("record_type", "record_id");

-- AddForeignKey
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_report_type_id_fkey" FOREIGN KEY ("report_type_id") REFERENCES "report_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_definition" ADD CONSTRAINT "workflow_definition_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_state" ADD CONSTRAINT "workflow_state_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_from_state_id_fkey" FOREIGN KEY ("from_state_id") REFERENCES "workflow_state"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_to_state_id_fkey" FOREIGN KEY ("to_state_id") REFERENCES "workflow_state"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_required_role_id_fkey" FOREIGN KEY ("required_role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instance" ADD CONSTRAINT "workflow_instance_current_state_id_fkey" FOREIGN KEY ("current_state_id") REFERENCES "workflow_state"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_reporting_rule_id_fkey" FOREIGN KEY ("reporting_rule_id") REFERENCES "reporting_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 5.1 — Postgres RLS on `deadline`, same template as phase2_3.
-- `deadline` carries `company_id` directly (per the canonical ERD) and is
-- queried directly by company (deadline lists, escalation scans) rather
-- than only reached via an already-scoped parent record, so it gets a real
-- RLS policy — unlike `workflow_instance`, which the ERD deliberately
-- leaves company_id-less (see the Prisma schema comment above its model).
ALTER TABLE "deadline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deadline" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "deadline"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
