-- VigiCloud Phase 11 Stage 10 (Duplicate Linking & Detection) + Stage 11
-- (Case Follow-Up). Hand-written from `prisma migrate diff`'s raw output —
-- the diff's own 8 DropIndex statements (audit_entry's BRIN index + the 7
-- pg_trgm indexes on product/registration/meddra_term/who_drug_term) are
-- the same known false positive documented in CLAUDE.md's gotchas list
-- (Prisma's schema diffing doesn't recognize indexes created via raw SQL
-- in earlier migrations) and have been stripped here, exactly like every
-- prior migration in this repo that touched a table carrying one of them.

-- CreateEnum
CREATE TYPE "DuplicateReviewStatus" AS ENUM ('possible', 'confirmed_duplicate', 'not_duplicate');

-- CreateEnum
CREATE TYPE "DuplicateResolutionPattern" AS ENUM ('allocation', 'creation');

-- CreateEnum
CREATE TYPE "CaseFollowUpStatus" AS ENUM ('pending_attempt_1', 'pending_attempt_2', 'closed_resolved', 'closed_failed');

-- CreateEnum
CREATE TYPE "FollowUpChannel" AS ENUM ('email', 'phone');

-- CreateEnum
CREATE TYPE "FollowUpAttemptOutcome" AS ENUM ('pending', 'responded_resolved', 'responded_new_information', 'no_response');

-- AlterEnum: Stage 11 — a new notification category for follow-up triggers
ALTER TYPE "NotificationCategory" ADD VALUE 'case_follow_up';

-- AlterTable
ALTER TABLE "notification_preference" ADD COLUMN     "email_case_follow_up" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: Stage 10 — one row per compared pair of cases
CREATE TABLE "pv_duplicate_review" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "matched_case_id" UUID NOT NULL,
    "status" "DuplicateReviewStatus" NOT NULL DEFAULT 'possible',
    "matched_fields" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note_encrypted" TEXT,
    "resolution_pattern" "DuplicateResolutionPattern",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_duplicate_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Stage 11 — one active follow-up cycle per case
CREATE TABLE "pv_case_follow_up" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "status" "CaseFollowUpStatus" NOT NULL DEFAULT 'pending_attempt_1',
    "cycle_started_at" TIMESTAMP(3) NOT NULL,
    "closes_by_date" TIMESTAMP(3) NOT NULL,
    "last_response_at" TIMESTAMP(3),
    "next_check_due_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "started_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pv_case_follow_up_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Stage 11 — one row per contact attempt (system-triggered email or manually-logged phone)
CREATE TABLE "pv_case_follow_up_attempt" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "follow_up_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "channel" "FollowUpChannel" NOT NULL DEFAULT 'email',
    "outcome" "FollowUpAttemptOutcome" NOT NULL DEFAULT 'pending',
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "logged_by" UUID,
    "note_encrypted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pv_case_follow_up_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pv_duplicate_review_company_id_status_idx" ON "pv_duplicate_review"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pv_duplicate_review_case_id_matched_case_id_key" ON "pv_duplicate_review"("case_id", "matched_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "pv_case_follow_up_case_id_key" ON "pv_case_follow_up"("case_id");

-- CreateIndex
CREATE INDEX "pv_case_follow_up_company_id_status_idx" ON "pv_case_follow_up"("company_id", "status");

-- CreateIndex
CREATE INDEX "pv_case_follow_up_attempt_company_id_follow_up_id_idx" ON "pv_case_follow_up_attempt"("company_id", "follow_up_id");

-- AddForeignKey
ALTER TABLE "pv_duplicate_review" ADD CONSTRAINT "pv_duplicate_review_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_duplicate_review" ADD CONSTRAINT "pv_duplicate_review_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_duplicate_review" ADD CONSTRAINT "pv_duplicate_review_matched_case_id_fkey" FOREIGN KEY ("matched_case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_duplicate_review" ADD CONSTRAINT "pv_duplicate_review_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up" ADD CONSTRAINT "pv_case_follow_up_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up" ADD CONSTRAINT "pv_case_follow_up_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "pv_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up" ADD CONSTRAINT "pv_case_follow_up_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up_attempt" ADD CONSTRAINT "pv_case_follow_up_attempt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up_attempt" ADD CONSTRAINT "pv_case_follow_up_attempt_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "pv_case_follow_up"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pv_case_follow_up_attempt" ADD CONSTRAINT "pv_case_follow_up_attempt_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
