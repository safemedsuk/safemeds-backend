-- AlterTable
ALTER TABLE "pv_case" ADD COLUMN     "draft_claimed_at" TIMESTAMPTZ(3),
ADD COLUMN     "draft_claimed_by" UUID;

-- AddForeignKey
ALTER TABLE "pv_case" ADD CONSTRAINT "pv_case_draft_claimed_by_fkey" FOREIGN KEY ("draft_claimed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
