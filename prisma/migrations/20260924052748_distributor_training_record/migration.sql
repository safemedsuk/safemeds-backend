-- CreateTable
CREATE TABLE "distributor_training_record" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "training_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completion_date" DATE NOT NULL,
    "expiry_date" DATE,
    "certificate_document_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "distributor_training_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distributor_training_record_company_id_distributor_id_idx" ON "distributor_training_record"("company_id", "distributor_id");

-- AddForeignKey
ALTER TABLE "distributor_training_record" ADD CONSTRAINT "distributor_training_record_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_training_record" ADD CONSTRAINT "distributor_training_record_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_training_record" ADD CONSTRAINT "distributor_training_record_certificate_document_id_fkey" FOREIGN KEY ("certificate_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_training_record" ADD CONSTRAINT "distributor_training_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
