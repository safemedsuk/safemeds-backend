import { MetaWhatsAppWebhookPayload } from './dto/whatsapp-webhook.dto'
import { WhatsAppIntakeService } from './whatsapp-intake.service'

function buildHarness() {
  const handleMessage = jest.fn().mockResolvedValue(undefined)
  const chatbotService = { handleMessage } as never
  const service = new WhatsAppIntakeService(chatbotService)
  return { service, handleMessage }
}

function payloadWithMessages(fromIds: string[]): MetaWhatsAppWebhookPayload {
  return {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'phone-1' },
              messages: fromIds.map((from) => ({ from, text: { body: 'hi' } })),
            },
          },
        ],
      },
    ],
  }
}

describe('WhatsAppIntakeService', () => {
  describe('processWebhook()', () => {
    it('processes every flattened message in sequence, in order', async () => {
      const { service, handleMessage } = buildHarness()
      const callOrder: string[] = []
      handleMessage.mockImplementation((m: { from: string }) => {
        callOrder.push(m.from)
        return Promise.resolve()
      })

      await service.processWebhook(payloadWithMessages(['a', 'b', 'c']))

      expect(callOrder).toEqual(['a', 'b', 'c'])
    })

    it('continues processing the rest of the batch when one message handler throws', async () => {
      const { service, handleMessage } = buildHarness()
      handleMessage.mockImplementation((m: { from: string }) => {
        if (m.from === 'b') return Promise.reject(new Error('boom'))
        return Promise.resolve()
      })

      await expect(
        service.processWebhook(payloadWithMessages(['a', 'b', 'c'])),
      ).resolves.toBeUndefined()
      expect(handleMessage).toHaveBeenCalledTimes(3)
    })

    it('does nothing for an empty payload', async () => {
      const { service, handleMessage } = buildHarness()
      await service.processWebhook({})
      expect(handleMessage).not.toHaveBeenCalled()
    })
  })
})
