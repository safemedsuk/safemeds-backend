import { computeNextEurdPeriod, isEurdPeriodReady } from './eurd-cadence.util'

describe('computeNextEurdPeriod()', () => {
  it('starts the first period at the international birth date with a 6-month interval', () => {
    const ibd = new Date('2024-01-15T00:00:00.000Z')
    const period = computeNextEurdPeriod(ibd, null)

    expect(period.periodStart).toEqual(ibd)
    expect(period.intervalMonths).toBe(6)
    expect(period.periodEnd).toEqual(new Date('2024-07-15T00:00:00.000Z'))
  })

  it('uses a 70-day deadline for a 6-month (<=12-month) interval', () => {
    const ibd = new Date('2024-01-15T00:00:00.000Z')
    const period = computeNextEurdPeriod(ibd, null)
    const expectedDueAt = new Date(period.periodEnd)
    expectedDueAt.setUTCDate(expectedDueAt.getUTCDate() + 70)
    expect(period.dueAt).toEqual(expectedDueAt)
  })

  it('stays on 6-month intervals through the first 2 years (4 periods)', () => {
    const ibd = new Date('2024-01-01T00:00:00.000Z')
    let previousEnd: Date | null = null
    const intervals: number[] = []
    for (let i = 0; i < 4; i++) {
      const period = computeNextEurdPeriod(ibd, previousEnd)
      intervals.push(period.intervalMonths)
      previousEnd = period.periodEnd
    }
    expect(intervals).toEqual([6, 6, 6, 6])
    // After 4 periods of 6 months, exactly 24 months (2 years) have elapsed.
    expect(previousEnd).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('switches to annual (12-month) intervals starting in year 2-4', () => {
    const ibd = new Date('2024-01-01T00:00:00.000Z')
    // Fast-forward to exactly 2 years on market — the 5th period.
    const twoYearsOn = new Date('2026-01-01T00:00:00.000Z')
    const period = computeNextEurdPeriod(ibd, twoYearsOn)
    expect(period.intervalMonths).toBe(12)
    expect(period.periodEnd).toEqual(new Date('2027-01-01T00:00:00.000Z'))
  })

  it('uses a 90-day deadline once the interval exceeds 12 months (3-yearly, year 4+)', () => {
    const ibd = new Date('2024-01-01T00:00:00.000Z')
    const fourYearsOn = new Date('2028-01-01T00:00:00.000Z')
    const period = computeNextEurdPeriod(ibd, fourYearsOn)
    expect(period.intervalMonths).toBe(36)
    const expectedDueAt = new Date(period.periodEnd)
    expectedDueAt.setUTCDate(expectedDueAt.getUTCDate() + 90)
    expect(period.dueAt).toEqual(expectedDueAt)
  })

  it('uses a 90-day deadline exactly at the 12-month boundary is still 70 days (interval <= 12 counts as short)', () => {
    const ibd = new Date('2024-01-01T00:00:00.000Z')
    const twoYearsOn = new Date('2026-01-01T00:00:00.000Z')
    const period = computeNextEurdPeriod(ibd, twoYearsOn)
    expect(period.intervalMonths).toBe(12)
    const expectedDueAt = new Date(period.periodEnd)
    expectedDueAt.setUTCDate(expectedDueAt.getUTCDate() + 70)
    expect(period.dueAt).toEqual(expectedDueAt)
  })
})

describe('isEurdPeriodReady()', () => {
  it('is not ready before the Data Lock Point', () => {
    const period = computeNextEurdPeriod(new Date('2024-01-01T00:00:00.000Z'), null)
    expect(isEurdPeriodReady(period, new Date('2024-03-01T00:00:00.000Z'))).toBe(false)
  })

  it('is ready once the Data Lock Point has passed', () => {
    const period = computeNextEurdPeriod(new Date('2024-01-01T00:00:00.000Z'), null)
    expect(isEurdPeriodReady(period, new Date('2024-08-01T00:00:00.000Z'))).toBe(true)
  })
})
