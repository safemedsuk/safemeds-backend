-- CreateTable
CREATE TABLE "report_definition" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "data_source" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "group_by_field" TEXT,
    "schedule_cadence_days" INTEGER,
    "last_run_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_definition_company_id_created_at_idx" ON "report_definition"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definition" ADD CONSTRAINT "report_definition_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: tenant isolation, matching every other tenant-scoped table's convention.
ALTER TABLE "report_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_definition" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "report_definition"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
