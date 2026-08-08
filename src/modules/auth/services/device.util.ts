const BROWSERS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
]

const OPERATING_SYSTEMS: Array<[RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Linux/, 'Linux'],
]

/** Best-effort human-readable device label from a User-Agent header — no dependency, good enough for a sessions list. */
export function describeDevice(userAgent: string | undefined): string {
  if (!userAgent) {
    return 'Unknown device'
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown browser'
  const os = OPERATING_SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown OS'

  return `${browser} on ${os}`
}
