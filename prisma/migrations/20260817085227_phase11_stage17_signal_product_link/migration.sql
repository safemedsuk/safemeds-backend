-- AlterTable
ALTER TABLE "pv_signal" ADD COLUMN     "product_id" UUID;

-- AddForeignKey
ALTER TABLE "pv_signal" ADD CONSTRAINT "pv_signal_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
