-- AlterEnum
ALTER TYPE "ReportStatus" ADD VALUE 'qc_reviewed';

-- AlterTable
ALTER TABLE "generated_report" ADD COLUMN     "evidence_document_id" UUID;

-- AddForeignKey
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_evidence_document_id_fkey" FOREIGN KEY ("evidence_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
