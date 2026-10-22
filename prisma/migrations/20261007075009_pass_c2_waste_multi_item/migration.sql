-- AlterTable
ALTER TABLE "document_numbering_scheme" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "waste_disposal_case_item" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_disposal_case_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waste_disposal_case_item_company_id_case_id_idx" ON "waste_disposal_case_item"("company_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "waste_disposal_case_item_case_id_batch_id_key" ON "waste_disposal_case_item"("case_id", "batch_id");

-- AddForeignKey
ALTER TABLE "waste_disposal_case_item" ADD CONSTRAINT "waste_disposal_case_item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_item" ADD CONSTRAINT "waste_disposal_case_item_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "waste_disposal_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_item" ADD CONSTRAINT "waste_disposal_case_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_disposal_case_item" ADD CONSTRAINT "waste_disposal_case_item_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
