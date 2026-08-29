import { ServiceUnavailableException } from '@nestjs/common'

import { WhatsAppApiClient } from './whatsapp-api.client'

function buildHarness(accessToken: string | undefined) {
  const values: Record<string, unknown> = {
    WHATSAPP_ACCESS_TOKEN: accessToken,
    WHATSAPP_API_VERSION: 'v21.0',
  }
  const configService = { get: jest.fn().mockImplementation((key: string) => values[key]) }
  const client = new WhatsAppApiClient(configService as never)
  return { client }
}

describe('WhatsAppApiClient', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  describe('sendText()', () => {
    it('POSTs to the Graph API messages endpoint with the bearer token and message body', async () => {
      const { client } = buildHarness('test-access-token')
      const fetchMock = jest.fn().mockResolvedValue({ ok: true })
      global.fetch = fetchMock as never

      await client.sendText('phone-1', '254700000001', 'Hello there')

      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/phone-1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '254700000001',
            type: 'text',
            text: { body: 'Hello there' },
          }),
        }),
      )
    })

    it('does not throw when the send fails — logged, best-effort', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve('server error'),
        }) as never

      await expect(client.sendText('phone-1', '254700000001', 'Hello')).resolves.toBeUndefined()
    })

    it('does not throw when fetch itself rejects (network error) — logged, best-effort', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never

      await expect(client.sendText('phone-1', '254700000001', 'Hello')).resolves.toBeUndefined()
    })

    it('throws ServiceUnavailableException when WHATSAPP_ACCESS_TOKEN is not configured', async () => {
      const { client } = buildHarness(undefined)
      await expect(client.sendText('phone-1', '254700000001', 'Hello')).rejects.toThrow(
        ServiceUnavailableException,
      )
    })
  })

  describe('downloadMedia()', () => {
    it('resolves the media ID to a URL, then downloads the bytes, both bearer-authenticated', async () => {
      const { client } = buildHarness('test-access-token')
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              url: 'https://lookaside.example.com/media-1',
              mime_type: 'image/jpeg',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode('fake-image-bytes').buffer),
        })
      global.fetch = fetchMock as never

      const result = await client.downloadMedia('media-123')

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://graph.facebook.com/v21.0/media-123',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-access-token' } }),
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://lookaside.example.com/media-1',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-access-token' } }),
      )
      expect(result).toEqual({ buffer: Buffer.from('fake-image-bytes'), mimeType: 'image/jpeg' })
    })

    it('returns null when the media metadata lookup fails', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as never
      expect(await client.downloadMedia('media-123')).toBeNull()
    })

    it('returns null when the metadata has no url', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest
        .fn()
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ mime_type: 'image/jpeg' }),
        }) as never
      expect(await client.downloadMedia('media-123')).toBeNull()
    })

    it('returns null when the file download itself fails', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://x', mime_type: 'image/jpeg' }),
        })
        .mockResolvedValueOnce({ ok: false })
      expect(await client.downloadMedia('media-123')).toBeNull()
    })

    it('returns null (never throws) on a network error', async () => {
      const { client } = buildHarness('test-access-token')
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as never
      expect(await client.downloadMedia('media-123')).toBeNull()
    })
  })
})
