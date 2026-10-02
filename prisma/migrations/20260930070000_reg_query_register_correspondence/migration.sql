-- AlterTable
ALTER TABLE "reg_query" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "owner_user_id" UUID,
ADD COLUMN     "response_due_date" DATE;

-- CreateTable
CREATE TABLE "reg_query_correspondence" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reg_query_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "summary_encrypted" TEXT NOT NULL,
    "document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reg_query_correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reg_query_correspondence_company_id_reg_query_id_idx" ON "reg_query_correspondence"("company_id", "reg_query_id");

-- CreateIndex
CREATE INDEX "reg_query_company_id_status_idx" ON "reg_query"("company_id", "status");

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query" ADD CONSTRAINT "reg_query_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query_correspondence" ADD CONSTRAINT "reg_query_correspondence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query_correspondence" ADD CONSTRAINT "reg_query_correspondence_reg_query_id_fkey" FOREIGN KEY ("reg_query_id") REFERENCES "reg_query"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query_correspondence" ADD CONSTRAINT "reg_query_correspondence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reg_query_correspondence" ADD CONSTRAINT "reg_query_correspondence_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "reg_query_correspondence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reg_query_correspondence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reg_query_correspondence"
  USING (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.company_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );
