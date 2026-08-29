import {
  ConversationState,
  WhatsAppConversationStateService,
} from './whatsapp-conversation-state.service'

function buildHarness() {
  const store = new Map<string, string>()
  const client = {
    get: jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn().mockImplementation((key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve('OK')
    }),
    del: jest.fn().mockImplementation((key: string) => {
      store.delete(key)
      return Promise.resolve(1)
    }),
  }
  const redisService = { client }
  const service = new WhatsAppConversationStateService(redisService as never)
  return { service, client, store }
}

describe('WhatsAppConversationStateService', () => {
  it('returns null for a conversation with no stored state', async () => {
    const { service } = buildHarness()
    expect(await service.get('phone-1', 'wa-1')).toBeNull()
  })

  it('round-trips a stored state through JSON serialization', async () => {
    const { service } = buildHarness()
    const state: ConversationState = {
      step: 'awaiting_product',
      companyId: 'company-1',
      reporterName: 'Jane',
    }

    await service.set('phone-1', 'wa-1', state)
    expect(await service.get('phone-1', 'wa-1')).toEqual(state)
  })

  it('sets an expiry (EX) on every write', async () => {
    const { service, client } = buildHarness()
    await service.set('phone-1', 'wa-1', { step: 'awaiting_name', companyId: 'company-1' })
    expect(client.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'EX',
      expect.any(Number),
    )
  })

  it('keys conversations by both phoneNumberId and waId, keeping them independent', async () => {
    const { service } = buildHarness()
    await service.set('phone-1', 'wa-1', { step: 'awaiting_name', companyId: 'company-1' })
    await service.set('phone-2', 'wa-1', { step: 'awaiting_product', companyId: 'company-2' })

    expect(await service.get('phone-1', 'wa-1')).toMatchObject({ step: 'awaiting_name' })
    expect(await service.get('phone-2', 'wa-1')).toMatchObject({ step: 'awaiting_product' })
  })

  it('clear() removes the stored state', async () => {
    const { service } = buildHarness()
    await service.set('phone-1', 'wa-1', { step: 'awaiting_name', companyId: 'company-1' })
    await service.clear('phone-1', 'wa-1')
    expect(await service.get('phone-1', 'wa-1')).toBeNull()
  })
})
