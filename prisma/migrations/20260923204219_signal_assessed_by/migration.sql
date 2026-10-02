-- AlterTable
ALTER TABLE "pv_signal" ADD COLUMN     "assessed_by" UUID;

-- AddForeignKey
ALTER TABLE "pv_signal" ADD CONSTRAINT "pv_signal_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
