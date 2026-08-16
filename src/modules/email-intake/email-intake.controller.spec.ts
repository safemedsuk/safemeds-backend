import { BadRequestException, RawBodyRequest, ServiceUnavailableException } from '@nestjs/common'
import { createHmac } from 'crypto'
import type { Request } from 'express'

import { EmailIntakeController } from './email-intake.controller'

const SECRET = `whsec_${Buffer.from('a-test-signing-key-32-bytes-long').toString('base64')}`

function sign(id: string, timestamp: string, body: string): string {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')
  return `v1,${digest}`
}

function buildHarness(secret: string | undefined) {
  const processInboundEmail = jest
    .fn()
    .mockResolvedValue({ outcome: 'case_created', referenceNumber: 'PV-2026-00001' })
  const emailIntakeService = { processInboundEmail } as never
  const configService = { get: jest.fn().mockReturnValue(secret) } as never

  const controller = new EmailIntakeController(emailIntakeService, configService)
  return { controller, processInboundEmail }
}

function fakeRequest(rawBody: Buffer | undefined): RawBodyRequest<Request> {
  return { rawBody, ip: '5.5.5.5' } as unknown as RawBodyRequest<Request>
}

describe('EmailIntakeController', () => {
  const body = {
    type: 'email.received',
    data: { from: 'a@b.com', to: 'slug@intake.safemeds.test' },
  }
  const rawBody = Buffer.from(JSON.stringify(body))

  it('503s when RESEND_INBOUND_WEBHOOK_SECRET is not configured', async () => {
    const { controller } = buildHarness(undefined)
    await expect(
      controller.receive(body, fakeRequest(rawBody), 'id', '123', 'v1,sig'),
    ).rejects.toThrow(ServiceUnavailableException)
  })

  it('400s when signature headers are missing', async () => {
    const { controller } = buildHarness(SECRET)
    await expect(
      controller.receive(body, fakeRequest(rawBody), undefined, undefined, undefined),
    ).rejects.toThrow(BadRequestException)
  })

  it('400s when the signature does not verify', async () => {
    const { controller } = buildHarness(SECRET)
    await expect(
      controller.receive(
        body,
        fakeRequest(rawBody),
        'id',
        String(Math.floor(Date.now() / 1000)),
        'v1,not-a-real-signature',
      ),
    ).rejects.toThrow(BadRequestException)
  })

  it('delegates to the service when the signature verifies', async () => {
    const { controller, processInboundEmail } = buildHarness(SECRET)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign('msg-1', timestamp, rawBody.toString('utf8'))

    const result = await controller.receive(
      body,
      fakeRequest(rawBody),
      'msg-1',
      timestamp,
      signature,
    )

    expect(result).toEqual({ outcome: 'case_created', referenceNumber: 'PV-2026-00001' })
    expect(processInboundEmail).toHaveBeenCalledWith(body, { ip: '5.5.5.5' })
  })
})
