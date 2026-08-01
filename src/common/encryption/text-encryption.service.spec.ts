import { randomBytes } from 'crypto'

import { TextEncryptionService } from './text-encryption.service'

function buildService(key: string): TextEncryptionService {
  const configService = { get: () => key } as never
  return new TextEncryptionService(configService)
}

describe('TextEncryptionService', () => {
  it('round-trips a narrative-length string', () => {
    const service = buildService(randomBytes(32).toString('hex'))
    const narrative =
      'A female patient received medroxyprogesterone acetate (DEPO-PROVERA). ' +
      'The following information was reported: intermenstrual bleeding, heavy menstrual bleeding.'

    const ciphertext = service.encrypt(narrative)
    expect(ciphertext).not.toContain('medroxyprogesterone')
    expect(service.decrypt(ciphertext)).toBe(narrative)
  })

  it("two services with different keys cannot read each other's ciphertext", () => {
    const a = buildService(randomBytes(32).toString('hex'))
    const b = buildService(randomBytes(32).toString('hex'))

    const ciphertext = a.encrypt('confidential')
    expect(() => b.decrypt(ciphertext)).toThrow()
  })
})
