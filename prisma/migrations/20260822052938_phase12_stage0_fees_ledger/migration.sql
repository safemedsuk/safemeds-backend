-- The 8 `DROP INDEX` statements Prisma's own diff engine generated here have
-- been removed by hand, same as every prior RegCloud migration — see
-- `phase12_stage0_regcloud_foundation`'s own comment for the full account
-- of why (8 real hand-written BRIN/trigram indexes with no @@index
-- equivalent in schema.prisma).

-- CreateTable
CREATE TABLE "reg_fee_invoice" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_registration_id" UUID,
    "reg_dossier_id" UUID,
    "regulatory_fee_schedule_id" UUID,
    "fee_type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "notified_overdue_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reg_fee_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reg_fee_payment" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reg_fee_payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reg_fee_invoice_company_id_idx" ON "reg_fee_invoice"("company_id");

-- CreateIndex
CREATE INDEX "reg_fee_invoice_company_id_status_due_at_idx" ON "reg_fee_invoice"("company_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "reg_fee_payment_company_id_idx" ON "reg_fee_payment"("company_id");

-- CreateIndex
CREATE INDEX "reg_fee_payment_invoice_id_idx" ON "reg_fee_payment"("invoice_id");

-- AddForeignKey
ALTER TABLE "reg_fee_invoice" ADD CONSTRAINT "reg_fee_invoice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_invoice" ADD CONSTRAINT "reg_fee_invoice_product_registration_id_fkey" FOREIGN KEY ("product_registration_id") REFERENCES "product_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_invoice" ADD CONSTRAINT "reg_fee_invoice_reg_dossier_id_fkey" FOREIGN KEY ("reg_dossier_id") REFERENCES "reg_dossier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_invoice" ADD CONSTRAINT "reg_fee_invoice_regulatory_fee_schedule_id_fkey" FOREIGN KEY ("regulatory_fee_schedule_id") REFERENCES "regulatory_fee_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_invoice" ADD CONSTRAINT "reg_fee_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_payment" ADD CONSTRAINT "reg_fee_payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "reg_fee_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_payment" ADD CONSTRAINT "reg_fee_payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_fee_payment" ADD CONSTRAINT "reg_fee_payment_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RegCloud (Phase 12) Stage 0.5/0.6 — real Postgres RLS from day one for
-- both new tenant-owned tables, matching every other tenant table's own
-- template (Phase 7.1) — not retrofitted separately the way Stage 0.1-0.4's
-- own tables had to be (see `phase12_stage0_rls_hardening`).
ALTER TABLE "reg_fee_invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_fee_invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_fee_invoice"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

ALTER TABLE "reg_fee_payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_fee_payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_fee_payment"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
