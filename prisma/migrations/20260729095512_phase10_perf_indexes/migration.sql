-- Phase 10 load-sanity test found audit_entry/task's plain "list newest
-- first" queries (no recordType/status filter) fell back to a full
-- seq-scan+sort — fine at the 50k/5k rows tested, but audit_entry is an
-- unbounded, append-only regulatory trail with no pruning, so this
-- degrades over the product's lifetime. Add the missing covering indexes.

-- CreateIndex
CREATE INDEX "audit_entry_company_id_occurred_at_idx" ON "audit_entry"("company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "task_company_id_created_at_idx" ON "task"("company_id", "created_at");
