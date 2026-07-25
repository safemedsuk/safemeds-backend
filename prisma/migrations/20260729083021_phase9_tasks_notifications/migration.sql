-- Phase 9 — Task Inbox & Notifications. `prisma migrate diff` also wants
-- to drop audit_entry's BRIN index and the three pg_trgm indexes again —
-- the same recurring false-positive drift Prisma's DSL can't express;
-- deliberately not included here, same as every prior migration.

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'claimed', 'closed');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('task_assigned', 'deadline_approaching', 'deadline_breached', 'workflow_update');

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "assigned_role_key" TEXT,
    "assigned_user_id" UUID,
    "claimed_by" UUID,
    "claimed_at" TIMESTAMP(3),
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "record_type" TEXT,
    "record_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "user_id" UUID NOT NULL,
    "email_task_assigned" BOOLEAN NOT NULL DEFAULT true,
    "email_deadline" BOOLEAN NOT NULL DEFAULT true,
    "email_workflow_update" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "task_company_id_status_assigned_role_key_idx" ON "task"("company_id", "status", "assigned_role_key");

-- CreateIndex
CREATE INDEX "task_company_id_status_assigned_user_id_idx" ON "task"("company_id", "status", "assigned_user_id");

-- CreateIndex
CREATE INDEX "task_company_id_record_type_record_id_status_idx" ON "task"("company_id", "record_type", "record_id", "status");

-- CreateIndex
CREATE INDEX "notification_company_id_user_id_read_at_created_at_idx" ON "notification"("company_id", "user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — task/notification are tenant-scoped (company_id), same template
-- as every other tenant table. notification_preference is deliberately
-- NOT RLS-protected: it's always queried by exact userId = the caller's
-- own id (never a list), so there's no cross-tenant leak surface the way
-- there is for a real list endpoint.
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
