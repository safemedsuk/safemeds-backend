-- AlterTable
ALTER TABLE "clinical_trial" ADD COLUMN     "ethics_approval_date" DATE,
ADD COLUMN     "ethics_approval_document_id" UUID,
ADD COLUMN     "ethics_approval_expiry_date" DATE,
ADD COLUMN     "regulatory_approval_date" DATE,
ADD COLUMN     "regulatory_approval_document_id" UUID,
ADD COLUMN     "regulatory_approval_expiry_date" DATE;

-- AddForeignKey
ALTER TABLE "clinical_trial" ADD CONSTRAINT "clinical_trial_regulatory_approval_document_id_fkey" FOREIGN KEY ("regulatory_approval_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_trial" ADD CONSTRAINT "clinical_trial_ethics_approval_document_id_fkey" FOREIGN KEY ("ethics_approval_document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
