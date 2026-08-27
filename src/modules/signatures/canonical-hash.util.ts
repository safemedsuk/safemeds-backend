import { createHash } from 'crypto'

/**
 * Stable (sorted-key) JSON serialization — the same payload always produces
 * the same string regardless of the order its fields were constructed in,
 * which is what makes `hashCanonicalPayload` reproducible for `verify()`.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashCanonicalPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex')
}
