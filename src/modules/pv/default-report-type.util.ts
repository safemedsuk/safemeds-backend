import { Prisma, ReportType } from '@prisma/client'

/**
 * VigiCloud testing-todo Stage 3.1 — every reporter-blind intake channel
 * (public URL, inbound email, WhatsApp) needs a `reportTypeId` for the
 * case it creates, but none of these reporters ever pick one (they
 * wouldn't know PPB's six-form taxonomy). This is the single shared
 * answer: default to the `adr` report type, falling back to whichever
 * PV report type the company has configured first if `adr` itself isn't
 * seeded. This is a deliberate product decision, not a placeholder — a
 * spontaneous report reaching a company with no human triage in front
 * of it (a public form, an inbound email, a WhatsApp message) is, in
 * the overwhelming majority of real-world cases, an adverse drug
 * reaction; device incidents, quality complaints, and medication errors
 * are typically reported by professionals through channels that do let
 * them pick a type. Was previously duplicated verbatim across
 * `PublicReportingService`, `EmailIntakeService`, and
 * `WhatsAppChatbotService` — centralized here so the decision only ever
 * needs to change in one place.
 */
export async function resolveDefaultReportType(
  tx: Prisma.TransactionClient,
): Promise<ReportType | null> {
  const adr = await tx.reportType.findFirst({ where: { typeKey: 'adr', moduleKey: 'pv' } })
  if (adr) return adr
  return tx.reportType.findFirst({ where: { moduleKey: 'pv' } })
}
