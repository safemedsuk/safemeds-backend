import { InboundWhatsAppMessage } from './dto/whatsapp-webhook.dto'
import { WhatsAppChatbotService } from './whatsapp-chatbot.service'
import { ConversationState } from './whatsapp-conversation-state.service'

function buildHarness() {
  const companies = new Map([
    [
      'company-1',
      {
        id: 'company-1',
        name: 'FankamMeds Inc',
        whatsappBusinessPhoneNumberId: 'phone-1',
        status: 'active',
        homeCountryId: 'country-ke',
      },
    ],
  ])
  const reportTypes = [{ id: 'report-type-adr', typeKey: 'adr', moduleKey: 'pv' }]

  const tables = {
    company: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { whatsappBusinessPhoneNumberId?: string; status?: string; id?: string }
          }) =>
            Promise.resolve(
              [...companies.values()].find(
                (c) =>
                  (!where.whatsappBusinessPhoneNumberId ||
                    c.whatsappBusinessPhoneNumberId === where.whatsappBusinessPhoneNumberId) &&
                  (!where.status || c.status === where.status),
              ) ?? null,
            ),
        ),
      findFirstOrThrow: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const found = companies.get(where.id)
        if (!found) throw new Error('not found')
        return Promise.resolve(found)
      }),
    },
    reportType: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { typeKey?: string; moduleKey: string } }) =>
          Promise.resolve(
            reportTypes.find(
              (rt) =>
                (where.typeKey ? rt.typeKey === where.typeKey : true) &&
                rt.moduleKey === where.moduleKey,
            ) ?? null,
          ),
        ),
    },
  }
  const rls = { runWithSystemAccess: (fn: (tx: typeof tables) => unknown) => fn(tables) }

  const stateStore = new Map<string, ConversationState>()
  const stateService = {
    get: jest
      .fn()
      .mockImplementation((phoneNumberId: string, waId: string) =>
        Promise.resolve(stateStore.get(`${phoneNumberId}:${waId}`) ?? null),
      ),
    set: jest
      .fn()
      .mockImplementation((phoneNumberId: string, waId: string, state: ConversationState) => {
        stateStore.set(`${phoneNumberId}:${waId}`, state)
        return Promise.resolve()
      }),
    clear: jest.fn().mockImplementation((phoneNumberId: string, waId: string) => {
      stateStore.delete(`${phoneNumberId}:${waId}`)
      return Promise.resolve()
    }),
  }

  const sendText = jest.fn().mockResolvedValue(undefined)
  const downloadMedia = jest
    .fn()
    .mockResolvedValue({ buffer: Buffer.from('fake-image'), mimeType: 'image/jpeg' })
  const apiClient = { sendText, downloadMedia }

  const createFromSystemChannel = jest
    .fn()
    .mockResolvedValue({ id: 'case-1', referenceNumber: 'PV-2026-00001' })
  const pvCaseService = { createFromSystemChannel }

  const uploadDirectSystem = jest.fn().mockResolvedValue({ document: { id: 'doc-1' } })
  const documentsService = { uploadDirectSystem }

  const linkSystem = jest.fn().mockResolvedValue({ id: 'source-doc-1' })
  const sourceDocumentService = { linkSystem }

  const service = new WhatsAppChatbotService(
    rls as never,
    stateService as never,
    apiClient as never,
    pvCaseService as never,
    documentsService as never,
    sourceDocumentService as never,
  )
  return {
    service,
    sendText,
    downloadMedia,
    createFromSystemChannel,
    uploadDirectSystem,
    linkSystem,
    stateStore,
  }
}

function message(overrides: Partial<InboundWhatsAppMessage> = {}): InboundWhatsAppMessage {
  return {
    phoneNumberId: 'phone-1',
    from: '254700000001',
    profileName: 'Jane Reporter',
    ...overrides,
  }
}

describe('WhatsAppChatbotService', () => {
  describe('handleMessage()', () => {
    it("greets a brand-new conversation and asks for the reporter's name, without creating a case yet", async () => {
      const { service, sendText, createFromSystemChannel } = buildHarness()

      await service.handleMessage(message({ text: 'hi' }))

      expect(sendText).toHaveBeenCalledWith(
        'phone-1',
        '254700000001',
        expect.stringContaining('name'),
      )
      expect(createFromSystemChannel).not.toHaveBeenCalled()
    })

    it('walks the full name → product → event script and creates a real case entering the photo step', async () => {
      const { service, sendText, createFromSystemChannel, stateStore } = buildHarness()

      await service.handleMessage(message({ text: 'hi' })) // starts the conversation
      await service.handleMessage(message({ text: 'Jane Doe' })) // name
      await service.handleMessage(message({ text: 'Amoxil 500mg' })) // product
      await service.handleMessage(message({ text: 'I broke out in hives' })) // event -> creates the case

      expect(createFromSystemChannel).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({
          reportTypeId: 'report-type-adr',
          reporter: expect.objectContaining({
            reporterType: 'consumer',
            fullName: 'Jane Doe',
            phone: '254700000001',
          }),
          suspectProducts: [expect.objectContaining({ medicinalProduct: 'Amoxil 500mg' })],
          adverseEvents: [expect.objectContaining({ reportedTerm: 'I broke out in hives' })],
        }),
        'whatsapp_qr',
        '254700000001',
        {},
      )

      const state = stateStore.get('phone-1:254700000001')
      expect(state).toMatchObject({
        step: 'awaiting_photo',
        caseId: 'case-1',
        caseReferenceNumber: 'PV-2026-00001',
      })
      expect(sendText).toHaveBeenLastCalledWith(
        'phone-1',
        '254700000001',
        expect.stringContaining('PV-2026-00001'),
      )
    })

    it('re-prompts (does not advance) when a step receives an empty/whitespace-only reply', async () => {
      const { service, sendText } = buildHarness()
      await service.handleMessage(message({ text: 'hi' }))
      await service.handleMessage(message({ text: '   ' }))

      expect(sendText).toHaveBeenLastCalledWith(
        'phone-1',
        '254700000001',
        expect.stringContaining('Please reply with your name'),
      )
    })

    it('attaches a sent photo to the already-created case, links it as a SourceDocument, and clears the conversation', async () => {
      const { service, downloadMedia, uploadDirectSystem, linkSystem, stateStore } = buildHarness()
      await service.handleMessage(message({ text: 'hi' }))
      await service.handleMessage(message({ text: 'Jane Doe' }))
      await service.handleMessage(message({ text: 'Amoxil 500mg' }))
      await service.handleMessage(message({ text: 'Hives' }))

      await service.handleMessage(message({ imageId: 'media-123' }))

      expect(downloadMedia).toHaveBeenCalledWith('media-123')
      expect(uploadDirectSystem).toHaveBeenCalledWith(
        'company-1',
        'pv_case',
        'case-1',
        expect.objectContaining({ mimetype: 'image/jpeg' }),
        expect.objectContaining({ title: expect.any(String) }),
        {},
      )
      expect(linkSystem).toHaveBeenCalledWith('company-1', 'case-1', 'doc-1', {})
      expect(stateStore.has('phone-1:254700000001')).toBe(false)
    })

    it('finishes the conversation without a photo when the reporter replies "done" instead of sending an image', async () => {
      const { service, sendText, uploadDirectSystem, stateStore } = buildHarness()
      await service.handleMessage(message({ text: 'hi' }))
      await service.handleMessage(message({ text: 'Jane Doe' }))
      await service.handleMessage(message({ text: 'Amoxil 500mg' }))
      await service.handleMessage(message({ text: 'Hives' }))

      await service.handleMessage(message({ text: 'done' }))

      expect(uploadDirectSystem).not.toHaveBeenCalled()
      expect(stateStore.has('phone-1:254700000001')).toBe(false)
      expect(sendText).toHaveBeenLastCalledWith(
        'phone-1',
        '254700000001',
        expect.stringContaining('complete'),
      )
    })

    it('logs and no-ops for a phone_number_id that does not match any active company', async () => {
      const { service, sendText, createFromSystemChannel } = buildHarness()
      await service.handleMessage(message({ phoneNumberId: 'unknown-phone', text: 'hi' }))

      expect(sendText).not.toHaveBeenCalled()
      expect(createFromSystemChannel).not.toHaveBeenCalled()
    })

    it('two independent reporters texting the same number get two independent conversations', async () => {
      const { service, stateStore } = buildHarness()
      await service.handleMessage(message({ from: 'reporter-a', text: 'hi' }))
      await service.handleMessage(message({ from: 'reporter-b', text: 'hi' }))

      expect(stateStore.get('phone-1:reporter-a')).toMatchObject({ step: 'awaiting_name' })
      expect(stateStore.get('phone-1:reporter-b')).toMatchObject({ step: 'awaiting_name' })
    })
  })
})
