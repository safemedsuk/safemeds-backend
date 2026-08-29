import { extractInboundMessages, MetaWhatsAppWebhookPayload } from './whatsapp-webhook.dto'

describe('extractInboundMessages()', () => {
  it('flattens a text message out of the real Meta Cloud API envelope shape', () => {
    const payload: MetaWhatsAppWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001234', phone_number_id: 'phone-1' },
                contacts: [{ profile: { name: 'Jane Reporter' }, wa_id: '254700000001' }],
                messages: [
                  {
                    from: '254700000001',
                    id: 'wamid.1',
                    timestamp: '1699999999',
                    type: 'text',
                    text: { body: 'Hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    expect(extractInboundMessages(payload)).toEqual([
      {
        phoneNumberId: 'phone-1',
        from: '254700000001',
        profileName: 'Jane Reporter',
        text: 'Hello',
        imageId: undefined,
      },
    ])
  })

  it("extracts an image message's media ID", () => {
    const payload: MetaWhatsAppWebhookPayload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [
                  {
                    from: '254700000001',
                    type: 'image',
                    image: { id: 'media-123', mime_type: 'image/jpeg' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }

    expect(extractInboundMessages(payload)[0]).toMatchObject({ imageId: 'media-123' })
  })

  it('flattens messages across multiple entries/changes in one batch, preserving order', () => {
    const payload: MetaWhatsAppWebhookPayload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [{ from: 'a', text: { body: '1' } }],
              },
            },
          ],
        },
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-2' },
                messages: [{ from: 'b', text: { body: '2' } }],
              },
            },
          ],
        },
      ],
    }

    const result = extractInboundMessages(payload)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ phoneNumberId: 'phone-1', from: 'a' })
    expect(result[1]).toMatchObject({ phoneNumberId: 'phone-2', from: 'b' })
  })

  it('ignores non-"messages" change fields (e.g. status/delivery-receipt webhooks)', () => {
    const payload: MetaWhatsAppWebhookPayload = {
      entry: [{ changes: [{ field: 'message_template_status_update', value: {} }] }],
    }
    expect(extractInboundMessages(payload)).toEqual([])
  })

  it('skips a change with no phone_number_id (nothing to route on)', () => {
    const payload: MetaWhatsAppWebhookPayload = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { messages: [{ from: 'a', text: { body: 'hi' } }] } },
          ],
        },
      ],
    }
    expect(extractInboundMessages(payload)).toEqual([])
  })

  it('returns an empty array for an empty/missing envelope', () => {
    expect(extractInboundMessages({})).toEqual([])
  })
})
