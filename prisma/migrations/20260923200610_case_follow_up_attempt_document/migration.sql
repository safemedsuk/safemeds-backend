-- AlterTable
ALTER TABLE "pv_case_follow_up_attempt" ADD COLUMN     "document_id" UUID;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up_attempt" ADD CONSTRAINT "pv_case_follow_up_attempt_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
