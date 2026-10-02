-- NOTE: `prisma migrate diff` proposed 8 spurious `DROP INDEX`
-- statements here against real, load-bearing hand-written indexes
-- (the audit_entry BRIN index + 7 pg_trgm GIN indexes) that have zero
-- relationship to this migration's actual schema change — they exist
-- via raw SQL in earlier migrations with no `@@index` equivalent in
-- schema.prisma, so Prisma's diff engine proposes deleting what it
-- can't see declared. Stripped per CLAUDE.md's own documented gotcha
-- (confirmed real via `psql \di` before stripping, same discipline as
-- every prior migration that hit this).

-- CreateTable
CREATE TABLE "environmental_monitoring_result" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "cleanroom_grade" TEXT NOT NULL,
    "monitoring_type" TEXT NOT NULL,
    "sample_location" TEXT,
    "result" TEXT NOT NULL,
    "alert_limit" TEXT,
    "action_limit" TEXT,
    "excursion" BOOLEAN NOT NULL DEFAULT false,
    "excursion_level" TEXT,
    "sampled_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "environmental_monitoring_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stability_study" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID,
    "specification_id" UUID,
    "storage_condition" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stability_study_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stability_timepoint" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "stability_study_id" UUID NOT NULL,
    "timepoint_months" INTEGER NOT NULL,
    "pull_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "results" JSONB,
    "within_spec" BOOLEAN,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stability_timepoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environmental_monitoring_result_company_id_idx" ON "environmental_monitoring_result"("company_id");

-- CreateIndex
CREATE INDEX "environmental_monitoring_result_company_id_facility_id_samp_idx" ON "environmental_monitoring_result"("company_id", "facility_id", "sampled_at");

-- CreateIndex
CREATE INDEX "environmental_monitoring_result_company_id_excursion_idx" ON "environmental_monitoring_result"("company_id", "excursion");

-- CreateIndex
CREATE INDEX "stability_study_company_id_idx" ON "stability_study"("company_id");

-- CreateIndex
CREATE INDEX "stability_study_company_id_product_id_idx" ON "stability_study"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "stability_timepoint_company_id_idx" ON "stability_timepoint"("company_id");

-- CreateIndex
CREATE INDEX "stability_timepoint_stability_study_id_idx" ON "stability_timepoint"("stability_study_id");

-- AddForeignKey
ALTER TABLE "environmental_monitoring_result" ADD CONSTRAINT "environmental_monitoring_result_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_monitoring_result" ADD CONSTRAINT "environmental_monitoring_result_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environmental_monitoring_result" ADD CONSTRAINT "environmental_monitoring_result_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_specification_id_fkey" FOREIGN KEY ("specification_id") REFERENCES "specification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_study" ADD CONSTRAINT "stability_study_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_timepoint" ADD CONSTRAINT "stability_timepoint_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_timepoint" ADD CONSTRAINT "stability_timepoint_stability_study_id_fkey" FOREIGN KEY ("stability_study_id") REFERENCES "stability_study"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stability_timepoint" ADD CONSTRAINT "stability_timepoint_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — every new tenant table, in this same migration
-- (never retrofitted), matching this codebase's own established
-- discipline exactly.

ALTER TABLE "environmental_monitoring_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "environmental_monitoring_result" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "environmental_monitoring_result"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "stability_study" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stability_study" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stability_study"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "stability_timepoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stability_timepoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stability_timepoint"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
