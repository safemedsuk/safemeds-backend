import { randomBytes } from 'crypto'

/**
 * Every primary key in SafeMeds is UUID v7 (time-ordered), not v4 —
 * Prisma's own @default(uuid()) only generates v4, so IDs are generated
 * here and passed explicitly on every `create()` call.
 *
 * Implemented directly per RFC 9562 rather than via the `uuid` package:
 * `uuid@14` ships ESM-only, which ts-jest's CommonJS runtime can't load
 * (unlike plain Node, which has stable require(esm) support since 22.12) —
 * a small, dependency-free implementation sidesteps that entirely and
 * behaves identically under ts-node, the compiled app, and Jest.
 */
export function newId(): string {
  const bytes = randomBytes(16)
  const timestamp = BigInt(Date.now())

  bytes[0] = Number((timestamp >> 40n) & 0xffn)
  bytes[1] = Number((timestamp >> 32n) & 0xffn)
  bytes[2] = Number((timestamp >> 24n) & 0xffn)
  bytes[3] = Number((timestamp >> 16n) & 0xffn)
  bytes[4] = Number((timestamp >> 8n) & 0xffn)
  bytes[5] = Number(timestamp & 0xffn)

  bytes[6] = 0x70 | (bytes[6] & 0x0f) // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f) // variant 10

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
