import { addWindowDays } from './deadline-date.util'

describe('addWindowDays', () => {
  it('calendar: adds days straight through weekends', () => {
    // 2026-01-01 is a Thursday
    const result = addWindowDays(new Date('2026-01-01T00:00:00.000Z'), 15, 'calendar')
    expect(result.toISOString()).toBe('2026-01-16T00:00:00.000Z')
  })

  it('business: skips Saturdays and Sundays', () => {
    // 2026-01-01 is a Thursday; +1 business day -> Friday 2026-01-02
    const result = addWindowDays(new Date('2026-01-01T00:00:00.000Z'), 1, 'business')
    expect(result.toISOString()).toBe('2026-01-02T00:00:00.000Z')
  })

  it('business: a window spanning a weekend lands on the correct following business day', () => {
    // 2026-01-02 is a Friday; +1 business day should skip Sat/Sun and land on Monday 2026-01-05
    const result = addWindowDays(new Date('2026-01-02T00:00:00.000Z'), 1, 'business')
    expect(result.toISOString()).toBe('2026-01-05T00:00:00.000Z')
  })

  it('business: multiple business days across a weekend', () => {
    // Friday 2026-01-02 + 3 business days -> Mon(1) Tue(2) Wed(3) = 2026-01-07
    const result = addWindowDays(new Date('2026-01-02T00:00:00.000Z'), 3, 'business')
    expect(result.toISOString()).toBe('2026-01-07T00:00:00.000Z')
  })
})
