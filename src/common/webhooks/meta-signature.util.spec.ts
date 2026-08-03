import { createHmac } from 'crypto'

import { verifyMetaSignature } from './meta-signature.util'

const SECRET = 'test-app-secret'

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('verifyMetaSignature()', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }))

  it('accepts a correctly signed payload', () => {
    expect(verifyMetaSignature(body, sign(body, SECRET), SECRET)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyMetaSignature(body, sign(body, 'wrong-secret'), SECRET)).toBe(false)
  })

  it('rejects a body that was tampered with after signing', () => {
    const tampered = Buffer.from(JSON.stringify({ hello: 'tampered' }))
    expect(verifyMetaSignature(tampered, sign(body, SECRET), SECRET)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false)
  })

  it('rejects a header without the "sha256=" prefix', () => {
    expect(
      verifyMetaSignature(body, createHmac('sha256', SECRET).update(body).digest('hex'), SECRET),
    ).toBe(false)
  })

  it('rejects a malformed non-hex signature', () => {
    expect(verifyMetaSignature(body, 'sha256=not-hex-at-all!!', SECRET)).toBe(false)
  })
})
