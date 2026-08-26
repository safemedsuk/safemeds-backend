/**
 * VigiCloud Stage 18 — PSUR/PBRER periodicity, confirmed against GUD/022
 * §6.2 (the same primary source already used for the reporting-clock
 * deadlines and PSUR/PBRER cadence documented in CLAUDE.md's own domain-
 * knowledge notes): every 6 months for the first 2 years a product is on
 * market (from its international birth date), annually for the next 2
 * years, then every 3 years thereafter. Submission deadline is 70
 * calendar days of the Data Lock Point (period end) for intervals of 12
 * months or less, 90 days for longer intervals. A pure, independently
 * testable function — no DB access, no side effects, deliberately
 * separate from `PeriodicReportService`'s own orchestration exactly like
 * `computeNaranjoScore()` (Stage 8) was kept pure and separate from
 * `CausalityService`.
 */

export interface EurdPeriod {
  periodStart: Date
  /** The Data Lock Point — the cumulative-data cutoff for this report. */
  periodEnd: Date
  dueAt: Date
  intervalMonths: number
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function monthsSince(internationalBirthDate: Date, from: Date): number {
  return (
    (from.getUTCFullYear() - internationalBirthDate.getUTCFullYear()) * 12 +
    (from.getUTCMonth() - internationalBirthDate.getUTCMonth())
  )
}

function intervalMonthsAt(internationalBirthDate: Date, periodStart: Date): number {
  const monthsOnMarket = monthsSince(internationalBirthDate, periodStart)
  if (monthsOnMarket < 24) return 6
  if (monthsOnMarket < 48) return 12
  return 36
}

/**
 * The next EURD period after `previousPeriodEnd` (or the product's very
 * first period, starting at its international birth date, when
 * `previousPeriodEnd` is null). The interval length is determined by how
 * long the product had been on market *at the start* of this period —
 * matching GUD/022's own "for the first 2 years... for the next 2
 * years... thereafter" phrasing, which describes fixed calendar windows
 * from the birth date, not a recalculation relative to "now."
 */
export function computeNextEurdPeriod(
  internationalBirthDate: Date,
  previousPeriodEnd: Date | null,
): EurdPeriod {
  const periodStart = previousPeriodEnd
    ? new Date(previousPeriodEnd)
    : new Date(internationalBirthDate)
  const intervalMonths = intervalMonthsAt(internationalBirthDate, periodStart)
  const periodEnd = addMonths(periodStart, intervalMonths)
  const deadlineDays = intervalMonths <= 12 ? 70 : 90
  const dueAt = addDays(periodEnd, deadlineDays)

  return { periodStart, periodEnd, dueAt, intervalMonths }
}

/** Whether the Data Lock Point for a computed period has actually been reached — a period isn't generatable before its own cutoff exists. */
export function isEurdPeriodReady(period: EurdPeriod, asOf: Date): boolean {
  return asOf.getTime() >= period.periodEnd.getTime()
}
