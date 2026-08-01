import { randomBytes } from 'crypto'

import { decryptWithKey, encryptWithKey } from './aes-gcm.util'

const KEY = randomBytes(32).toString('hex')

describe('aes-gcm.util', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'Patient reports intermenstrual bleeding since 11 June.'
    const ciphertext = encryptWithKey(plaintext, KEY)

    expect(ciphertext).not.toContain(plaintext)
    expect(decryptWithKey(ciphertext, KEY)).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const plaintext = 'same input'
    const a = encryptWithKey(plaintext, KEY)
    const b = encryptWithKey(plaintext, KEY)

    expect(a).not.toBe(b)
    expect(decryptWithKey(a, KEY)).toBe(plaintext)
    expect(decryptWithKey(b, KEY)).toBe(plaintext)
  })

  it('rejects decryption under the wrong key (auth tag mismatch)', () => {
    const ciphertext = encryptWithKey('secret narrative text', KEY)
    const wrongKey = randomBytes(32).toString('hex')

    expect(() => decryptWithKey(ciphertext, wrongKey)).toThrow()
  })

  it('rejects a tampered ciphertext', () => {
    const ciphertext = encryptWithKey('secret narrative text', KEY)
    const raw = Buffer.from(ciphertext, 'base64')
    raw[raw.length - 1] ^= 0xff // flip the last ciphertext byte
    const tampered = raw.toString('base64')

    expect(() => decryptWithKey(tampered, KEY)).toThrow()
  })

  it('handles empty string plaintext', () => {
    const ciphertext = encryptWithKey('', KEY)
    expect(decryptWithKey(ciphertext, KEY)).toBe('')
  })

  it('handles unicode plaintext', () => {
    const plaintext = 'Mgonjwa aliripoti maumivu ya kichwa — 头痛 — 🩺'
    const ciphertext = encryptWithKey(plaintext, KEY)
    expect(decryptWithKey(ciphertext, KEY)).toBe(plaintext)
  })
})
