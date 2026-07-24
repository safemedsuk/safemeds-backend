-- NOTE: as in the phase5_1 migration, Prisma's diff engine wants to drop
-- `audit_entry_occurred_at_brin_idx` here because a BRIN index isn't
-- representable via Prisma's `@@index` — it's real Phase 3.1 infrastructure,
-- not drift. Deliberately omitted from this migration.

-- CreateTable
CREATE TABLE "signature_event" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "record_hash_sha256" TEXT NOT NULL,
    "signer_id" UUID NOT NULL,
    "role_at_signing" TEXT NOT NULL,
    "intent_statement" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auth_method" TEXT NOT NULL,

    CONSTRAINT "signature_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signature_event_company_id_record_type_record_id_idx" ON "signature_event"("company_id", "record_type", "record_id");

-- AddForeignKey
ALTER TABLE "signature_event" ADD CONSTRAINT "signature_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_event" ADD CONSTRAINT "signature_event_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 6.1 — same append-only enforcement as audit_entry (phase3_1):
-- REVOKE UPDATE/DELETE from the app's own connecting role, plus a trigger
-- so even a future superuser session can't silently rewrite a signature.
REVOKE UPDATE, DELETE ON "signature_event" FROM "safemeds";

CREATE OR REPLACE FUNCTION signature_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signature_event is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signature_event_no_update
  BEFORE UPDATE ON "signature_event"
  FOR EACH ROW EXECUTE FUNCTION signature_event_immutable();

CREATE TRIGGER signature_event_no_delete
  BEFORE DELETE ON "signature_event"
  FOR EACH ROW EXECUTE FUNCTION signature_event_immutable();
