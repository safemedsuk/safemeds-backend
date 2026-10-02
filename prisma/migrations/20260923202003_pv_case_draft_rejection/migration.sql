-- AlterTable
ALTER TABLE "pv_case" ADD COLUMN     "draft_rejected_at" TIMESTAMPTZ(3),
ADD COLUMN     "draft_rejection_reason" TEXT;
