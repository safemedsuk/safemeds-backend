import { DayType } from '@prisma/client'

/**
 * Adds `windowDays` to `from`. `calendar` is a plain day addition;
 * `business` skips Saturdays/Sundays (public holidays are not modeled yet —
 * every Kenyan PPB form's own "calendar days" convention is what Phase 4
 * actually seeds today, so this branch exists for schema completeness and
 * future markets, not because it's exercised by seeded Kenya data).
 */
export function addWindowDays(from: Date, windowDays: number, dayType: DayType): Date {
  if (dayType === 'calendar') {
    const result = new Date(from)
    result.setUTCDate(result.getUTCDate() + windowDays)
    return result
  }

  const result = new Date(from)
  let remaining = windowDays
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const day = result.getUTCDay()
    if (day !== 0 && day !== 6) {
      remaining -= 1
    }
  }
  return result
}
