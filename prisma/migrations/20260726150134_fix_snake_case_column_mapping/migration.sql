-- DropForeignKey
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_companyId_fkey";

-- DropForeignKey
ALTER TABLE "audit_entry" DROP CONSTRAINT "audit_entry_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "audit_entry" DROP CONSTRAINT "audit_entry_companyId_fkey";

-- DropForeignKey
ALTER TABLE "company" DROP CONSTRAINT "company_homeCountryId_fkey";

-- DropForeignKey
ALTER TABLE "company_registration" DROP CONSTRAINT "company_registration_companyId_fkey";

-- DropForeignKey
ALTER TABLE "company_registration" DROP CONSTRAINT "company_registration_countryId_fkey";

-- DropForeignKey
ALTER TABLE "company_registration" DROP CONSTRAINT "company_registration_reviewedBy_fkey";

-- DropForeignKey
ALTER TABLE "login_attempt" DROP CONSTRAINT "login_attempt_userId_fkey";

-- DropForeignKey
ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_userId_fkey";

-- DropForeignKey
ALTER TABLE "security_policy" DROP CONSTRAINT "security_policy_companyId_fkey";

-- DropIndex
DROP INDEX "audit_entry_actorUserId_occurredAt_idx";

-- DropIndex
DROP INDEX "audit_entry_companyId_recordType_recordId_occurredAt_idx";

-- DropIndex
DROP INDEX "company_registration_companyId_key";

-- DropIndex
DROP INDEX "company_registration_referenceNumber_key";

-- DropIndex
DROP INDEX "country_isoCode_key";

-- DropIndex
DROP INDEX "login_attempt_email_occurredAt_idx";

-- DropIndex
DROP INDEX "refresh_token_familyId_idx";

-- DropIndex
DROP INDEX "refresh_token_tokenHash_key";

-- DropIndex
DROP INDEX "refresh_token_userId_idx";

-- DropIndex
DROP INDEX "security_policy_companyId_key";

-- AlterTable
ALTER TABLE "app_user" DROP COLUMN "companyId",
DROP COLUMN "createdAt",
DROP COLUMN "fullName",
DROP COLUMN "isExternal",
DROP COLUMN "mustChangePassword",
DROP COLUMN "passwordHash",
DROP COLUMN "platformRole",
DROP COLUMN "roleKeys",
DROP COLUMN "tokenVersion",
DROP COLUMN "updatedAt",
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "full_name" TEXT NOT NULL,
ADD COLUMN     "is_external" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_hash" TEXT NOT NULL,
ADD COLUMN     "platform_role" "PlatformRole",
ADD COLUMN     "role_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "audit_entry" DROP COLUMN "actorType",
DROP COLUMN "actorUserId",
DROP COLUMN "companyId",
DROP COLUMN "newValue",
DROP COLUMN "occurredAt",
DROP COLUMN "oldValue",
DROP COLUMN "recordId",
DROP COLUMN "recordType",
ADD COLUMN     "actor_type" "AuditActorType" NOT NULL DEFAULT 'user',
ADD COLUMN     "actor_user_id" UUID,
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "new_value" JSONB,
ADD COLUMN     "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "old_value" JSONB,
ADD COLUMN     "record_id" TEXT,
ADD COLUMN     "record_type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "company" DROP COLUMN "companyType",
DROP COLUMN "createdAt",
DROP COLUMN "homeCountryId",
DROP COLUMN "updatedAt",
ADD COLUMN     "company_type" "CompanyType" NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "home_country_id" UUID NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "company_registration" DROP COLUMN "adminEmail",
DROP COLUMN "adminFullName",
DROP COLUMN "adminPasswordHash",
DROP COLUMN "adminPhone",
DROP COLUMN "companyId",
DROP COLUMN "companyName",
DROP COLUMN "companyType",
DROP COLUMN "countryId",
DROP COLUMN "createdAt",
DROP COLUMN "decidedAt",
DROP COLUMN "licenceDocKey",
DROP COLUMN "licenceDocSha256",
DROP COLUMN "licenceNumber",
DROP COLUMN "referenceNumber",
DROP COLUMN "rejectionReason",
DROP COLUMN "reviewedBy",
DROP COLUMN "updatedAt",
DROP COLUMN "verificationAttempts",
DROP COLUMN "verificationCodeExpiresAt",
DROP COLUMN "verificationCodeHash",
DROP COLUMN "verificationLastSentAt",
ADD COLUMN     "admin_email" TEXT NOT NULL,
ADD COLUMN     "admin_full_name" TEXT NOT NULL,
ADD COLUMN     "admin_password_hash" TEXT NOT NULL,
ADD COLUMN     "admin_phone" TEXT,
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "company_name" TEXT NOT NULL,
ADD COLUMN     "company_type" "CompanyType" NOT NULL,
ADD COLUMN     "country_id" UUID NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "licence_doc_key" TEXT,
ADD COLUMN     "licence_doc_sha256" TEXT,
ADD COLUMN     "licence_number" TEXT NOT NULL,
ADD COLUMN     "reference_number" TEXT NOT NULL,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "reviewed_by" UUID,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verification_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verification_code_expires_at" TIMESTAMP(3),
ADD COLUMN     "verification_code_hash" TEXT,
ADD COLUMN     "verification_last_sent_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "country" DROP COLUMN "createdAt",
DROP COLUMN "isoCode",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "iso_code" VARCHAR(2) NOT NULL;

-- AlterTable
ALTER TABLE "login_attempt" DROP COLUMN "occurredAt",
DROP COLUMN "userAgent",
DROP COLUMN "userId",
ADD COLUMN     "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "user_id" UUID;

-- AlterTable
ALTER TABLE "refresh_token" DROP COLUMN "createdAt",
DROP COLUMN "expiresAt",
DROP COLUMN "familyId",
DROP COLUMN "revokedAt",
DROP COLUMN "tokenHash",
DROP COLUMN "userAgent",
DROP COLUMN "userId",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "family_id" UUID NOT NULL,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "token_hash" TEXT NOT NULL,
ADD COLUMN     "user_agent" TEXT,
ADD COLUMN     "user_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "security_policy" DROP COLUMN "companyId",
DROP COLUMN "createdAt",
DROP COLUMN "mfaRequiredForSignatureRoles",
DROP COLUMN "minPasswordLength",
DROP COLUMN "sessionTimeoutMinutes",
DROP COLUMN "updatedAt",
ADD COLUMN     "company_id" UUID NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "mfa_required_for_signature_roles" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "min_password_length" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "session_timeout_minutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "audit_entry_company_id_record_type_record_id_occurred_at_idx" ON "audit_entry"("company_id", "record_type", "record_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_entry_actor_user_id_occurred_at_idx" ON "audit_entry"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_registration_reference_number_key" ON "company_registration"("reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "company_registration_company_id_key" ON "company_registration"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "country_iso_code_key" ON "country"("iso_code");

-- CreateIndex
CREATE INDEX "login_attempt_email_occurred_at_idx" ON "login_attempt"("email", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "security_policy_company_id_key" ON "security_policy"("company_id");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_home_country_id_fkey" FOREIGN KEY ("home_country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_policy" ADD CONSTRAINT "security_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

