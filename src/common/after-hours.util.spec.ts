import { isAfterHoursOrWeekend } from './after-hours.util'

describe('isAfterHoursOrWeekend()', () => {
  it('is false for a weekday within business hours (Wed 10:00 UTC)', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-12T10:00:00Z'))).toBe(false) // Wednesday
  })

  it('is true before 08:00 UTC on a weekday', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-12T07:59:00Z'))).toBe(true)
  })

  it('is true at/after 18:00 UTC on a weekday', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-12T18:00:00Z'))).toBe(true)
  })

  it('is false at the boundary 08:00 UTC (start of business hours)', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-12T08:00:00Z'))).toBe(false)
  })

  it('is false at the boundary 17:59 UTC (still within business hours)', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-12T17:59:00Z'))).toBe(false)
  })

  it('is true on a Saturday, even at midday', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-08T12:00:00Z'))).toBe(true)
  })

  it('is true on a Sunday, even at midday', () => {
    expect(isAfterHoursOrWeekend(new Date('2026-08-09T12:00:00Z'))).toBe(true)
  })
})
