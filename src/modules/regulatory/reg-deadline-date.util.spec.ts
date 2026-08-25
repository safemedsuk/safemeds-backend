import { addInterval } from './reg-deadline-date.util'

describe('addInterval', () => {
  it('adds a plain day count', () => {
    expect(addInterval(new Date('2026-01-01T00:00:00.000Z'), 30, 'days').toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    )
  })

  it('adds months, rolling over the year boundary correctly', () => {
    expect(addInterval(new Date('2026-11-01T00:00:00.000Z'), 3, 'months').toISOString()).toBe(
      '2027-02-01T00:00:00.000Z',
    )
  })

  it('adds years using real calendar arithmetic — never drifts across a leap year, unlike a fixed day-count would', () => {
    // 1 Mar 2026 + 5 years must land on 1 Mar 2031 exactly — a naive
    // `windowDays`-style day count (1825 or 1826) would land a day off
    // depending on how many leap years (2028) fell inside the span.
    const from = new Date('2026-03-01T00:00:00.000Z')
    const result = addInterval(from, 5, 'years')
    expect(result.toISOString()).toBe('2031-03-01T00:00:00.000Z')

    const daysBetween = Math.round((result.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    // Real span includes exactly one leap day (2028) across these 5 years.
    expect(daysBetween).toBe(5 * 365 + 1)
  })

  it('handles a leap-day source date (29 Feb) landing on a non-leap year by rolling to 1 March, matching native Date semantics', () => {
    const result = addInterval(new Date('2028-02-29T00:00:00.000Z'), 1, 'years')
    expect(result.toISOString()).toBe('2029-03-01T00:00:00.000Z')
  })

  it('never mutates the input date', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const original = from.getTime()
    addInterval(from, 10, 'years')
    expect(from.getTime()).toBe(original)
  })
})
