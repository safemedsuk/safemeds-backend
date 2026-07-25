-- The 5 DROP INDEX statements Prisma proposed here (BRIN on audit_entry,
-- trigram indexes on product/meddra_term) are phantom drift — those are
-- hand-written raw-SQL indexes with no @@index representation in
-- schema.prisma, and must never actually be dropped. Stripped manually,
-- same as every prior migration in this project that touched a table
-- near one of them.

-- CreateIndex
CREATE INDEX "generated_report_company_id_created_at_idx" ON "generated_report"("company_id", "created_at");
