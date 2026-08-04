import { createHmac } from 'crypto'

import { verifySvixSignature } from './svix-signature.util'

const SECRET = `whsec_${Buffer.from('a-test-signing-key-32-bytes-long').toString('base64')}`

function sign(id: string, timestamp: string, body: string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${id}.${timestamp}.${body}`
  const digest = createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  return `v1,${digest}`
}

describe('verifySvixSignature()', () => {
  const id = 'msg_2abc123'
  const body = Buffer.from(JSON.stringify({ hello: 'world' }))

  function freshTimestamp(): string {
    return String(Math.floor(Date.now() / 1000))
  }

  it('accepts a correctly signed payload', () => {
    const timestamp = freshTimestamp()
    const signature = sign(id, timestamp, body.toString('utf8'), SECRET)

    expect(verifySvixSignature(body, { id, timestamp, signature }, SECRET)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    const timestamp = freshTimestamp()
    const wrongSecret = `whsec_${Buffer.from('a-completely-different-key-value').toString('base64')}`
    const signature = sign(id, timestamp, body.toString('utf8'), wrongSecret)

    expect(verifySvixSignature(body, { id, timestamp, signature }, SECRET)).toBe(false)
  })

  it('rejects a body that was tampered with after signing', () => {
    const timestamp = freshTimestamp()
    const signature = sign(id, timestamp, body.toString('utf8'), SECRET)
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'tampered' }))

    expect(verifySvixSignature(tamperedBody, { id, timestamp, signature }, SECRET)).toBe(false)
  })

  it('rejects a signature whose id does not match the header id (signed content mismatch)', () => {
    const timestamp = freshTimestamp()
    const signature = sign('a-different-msg-id', timestamp, body.toString('utf8'), SECRET)

    expect(verifySvixSignature(body, { id, timestamp, signature }, SECRET)).toBe(false)
  })

  it('rejects a stale timestamp outside the tolerance window', () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600)
    const signature = sign(id, staleTimestamp, body.toString('utf8'), SECRET)

    expect(verifySvixSignature(body, { id, timestamp: staleTimestamp, signature }, SECRET)).toBe(
      false,
    )
  })

  it('accepts when the matching signature is one of several space-separated candidates', () => {
    const timestamp = freshTimestamp()
    const real = sign(id, timestamp, body.toString('utf8'), SECRET)
    const signature = `v1,not-a-real-signature ${real}`

    expect(verifySvixSignature(body, { id, timestamp, signature }, SECRET)).toBe(true)
  })

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifySvixSignature(
        body,
        { id, timestamp: 'not-a-number', signature: 'v1,anything' },
        SECRET,
      ),
    ).toBe(false)
  })
})
