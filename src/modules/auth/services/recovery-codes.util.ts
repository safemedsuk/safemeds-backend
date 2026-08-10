import { randomInt } from 'crypto'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L — avoids transcription errors
const GROUP_LENGTH = 5
const RECOVERY_CODE_COUNT = 8

function generateCode(): string {
  let group1 = ''
  let group2 = ''
  for (let i = 0; i < GROUP_LENGTH; i += 1) {
    group1 += ALPHABET[randomInt(ALPHABET.length)]
    group2 += ALPHABET[randomInt(ALPHABET.length)]
  }
  return `${group1}-${group2}`
}

/** 8 single-use MFA recovery codes, formatted `XXXXX-XXXXX` for readability. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateCode)
}
