import { BadRequestException, RawBodyRequest, ServiceUnavailableException } from '@nestjs/common'
import { createHmac } from 'crypto'
import type { Request, Response } from 'express'

import { WhatsAppIntakeController } from './whatsapp-intake.controller'

const APP_SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
}

function buildHarness(
  opts: { appSecret?: string; verifyToken?: string } = {
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
  },
) {
  const processWebhook = jest.fn().mockResolvedValue(undefined)
  const whatsAppIntakeService = { processWebhook } as never

  const values: Record<string, unknown> = {
    WHATSAPP_APP_SECRET: opts.appSecret,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: opts.verifyToken,
  }
  const configService = { get: jest.fn().mockImplementation((key: string) => values[key]) } as never

  const controller = new WhatsAppIntakeController(whatsAppIntakeService, configService)
  return { controller, processWebhook }
}

function fakeRequest(rawBody: Buffer | undefined): RawBodyRequest<Request> {
  return { rawBody } as unknown as RawBodyRequest<Request>
}

function fakeResponse() {
  const status = jest.fn().mockReturnThis()
  const send = jest.fn().mockReturnThis()
  const res = { status, send } as unknown as Response
  return { res, status, send }
}

describe('WhatsAppIntakeController', () => {
  describe('verify() — GET handshake', () => {
    it('echoes back hub.challenge when the mode and token are correct', () => {
      const { controller } = buildHarness()
      const { res, status, send } = fakeResponse()

      controller.verify('subscribe', VERIFY_TOKEN, 'challenge-123', res)

      expect(status).toHaveBeenCalledWith(200)
      expect(send).toHaveBeenCalledWith('challenge-123')
    })

    it('403s when the verify token does not match', () => {
      const { controller } = buildHarness()
      const { res, status } = fakeResponse()

      controller.verify('subscribe', 'wrong-token', 'challenge-123', res)

      expect(status).toHaveBeenCalledWith(403)
    })

    it('403s when the mode is not "subscribe"', () => {
      const { controller } = buildHarness()
      const { res, status } = fakeResponse()

      controller.verify('unsubscribe', VERIFY_TOKEN, 'challenge-123', res)

      expect(status).toHaveBeenCalledWith(403)
    })

    it('503s when WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured', () => {
      const { controller } = buildHarness({ appSecret: APP_SECRET, verifyToken: undefined })
      const { res, status } = fakeResponse()

      controller.verify('subscribe', 'anything', 'challenge-123', res)

      expect(status).toHaveBeenCalledWith(503)
    })
  })

  describe('receive() — POST webhook', () => {
    const body = { object: 'whatsapp_business_account', entry: [] }
    const rawBody = Buffer.from(JSON.stringify(body))

    it('503s when WHATSAPP_APP_SECRET is not configured', async () => {
      const { controller } = buildHarness({ appSecret: undefined, verifyToken: VERIFY_TOKEN })
      await expect(controller.receive(body, fakeRequest(rawBody), sign(rawBody))).rejects.toThrow(
        ServiceUnavailableException,
      )
    })

    it('400s when the signature does not verify', async () => {
      const { controller } = buildHarness()
      await expect(
        controller.receive(body, fakeRequest(rawBody), 'sha256=not-a-real-signature'),
      ).rejects.toThrow(BadRequestException)
    })

    it('400s when the signature header is missing entirely', async () => {
      const { controller } = buildHarness()
      await expect(controller.receive(body, fakeRequest(rawBody), undefined)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('delegates to the service when the signature verifies', async () => {
      const { controller, processWebhook } = buildHarness()
      const result = await controller.receive(body, fakeRequest(rawBody), sign(rawBody))

      expect(result).toEqual({ received: true })
      expect(processWebhook).toHaveBeenCalledWith(body)
    })
  })
})
