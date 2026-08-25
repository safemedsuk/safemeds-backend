/**
 * Adds a calendar interval to `from` — RegCloud's own equivalent of
 * `deadline-date.util.ts`'s `addWindowDays()`, deliberately NOT collapsed
 * into a single day count the way that PV util is. A 5-year renewal
 * expressed as raw days (1825 vs 1826) drifts across leap years; using
 * `setUTCFullYear`/`setUTCMonth` instead performs real calendar arithmetic,
 * so "5 years from 1 March 2026" is always exactly 1 March 2031, never off
 * by a day depending on how many leap years fell in between.
 */
export function addInterval(from: Date, value: number, unit: 'days' | 'months' | 'years'): Date {
  const result = new Date(from)
  switch (unit) {
    case 'days':
      result.setUTCDate(result.getUTCDate() + value)
      return result
    case 'months':
      result.setUTCMonth(result.getUTCMonth() + value)
      return result
    case 'years':
      result.setUTCFullYear(result.getUTCFullYear() + value)
      return result
  }
}
