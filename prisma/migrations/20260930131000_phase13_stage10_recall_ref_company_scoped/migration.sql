-- Corrective migration: `recall.ref` must be unique per-company, not
-- globally unique (multi-tenant — two different companies can each
-- legitimately mint "REC-2026-0001"), matching `RegVariation.displayCode`/
-- `RecallReturnRecord.ref`'s own `@@unique([companyId, ...])` precedent.
DROP INDEX "recall_ref_key";
CREATE UNIQUE INDEX "recall_company_id_ref_key" ON "recall"("company_id", "ref");
