-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('manufacturer', 'importer_distributor', 'pharmacy_chain', 'e_pharmacy');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "CompanyRegistrationStatus" AS ENUM ('pending_verification', 'under_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'deactivated');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('super_admin', 'operations', 'support');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('user', 'system');

-- CreateTable
CREATE TABLE "country" (
    "id" UUID NOT NULL,
    "isoCode" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "companyType" "CompanyType" NOT NULL,
    "homeCountryId" UUID NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_policy" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "minPasswordLength" INTEGER NOT NULL DEFAULT 12,
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "mfaRequiredForSignatureRoles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_registration" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyType" "CompanyType" NOT NULL,
    "countryId" UUID NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "licenceDocKey" TEXT,
    "licenceDocSha256" TEXT,
    "adminFullName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "adminPhone" TEXT,
    "adminPasswordHash" TEXT NOT NULL,
    "status" "CompanyRegistrationStatus" NOT NULL DEFAULT 'pending_verification',
    "verificationCodeHash" TEXT,
    "verificationCodeExpiresAt" TIMESTAMP(3),
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationLastSentAt" TIMESTAMP(3),
    "companyId" UUID,
    "reviewedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "platformRole" "PlatformRole",
    "roleKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "device" TEXT,
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "userId" UUID,
    "success" BOOLEAN NOT NULL,
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entry" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "actorUserId" UUID,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ip" VARCHAR(45),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_isoCode_key" ON "country"("isoCode");

-- CreateIndex
CREATE UNIQUE INDEX "security_policy_companyId_key" ON "security_policy"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_registration_referenceNumber_key" ON "company_registration"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "company_registration_companyId_key" ON "company_registration"("companyId");

-- CreateIndex
CREATE INDEX "company_registration_status_idx" ON "company_registration"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_tokenHash_key" ON "refresh_token"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_token_userId_idx" ON "refresh_token"("userId");

-- CreateIndex
CREATE INDEX "refresh_token_familyId_idx" ON "refresh_token"("familyId");

-- CreateIndex
CREATE INDEX "login_attempt_email_occurredAt_idx" ON "login_attempt"("email", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_entry_companyId_recordType_recordId_occurredAt_idx" ON "audit_entry"("companyId", "recordType", "recordId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_entry_actorUserId_occurredAt_idx" ON "audit_entry"("actorUserId", "occurredAt");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_homeCountryId_fkey" FOREIGN KEY ("homeCountryId") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_policy" ADD CONSTRAINT "security_policy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_registration" ADD CONSTRAINT "company_registration_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
