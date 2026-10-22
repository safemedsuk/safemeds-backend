import { WasteDestructionPdfService } from './waste-destruction-pdf.service'

// A real 1x1 PNG.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('WasteDestructionPdfService', () => {
  const service = new WasteDestructionPdfService()

  it('accepts JPEG and PNG and refuses everything else', () => {
    expect(service.isSupportedMimeType('image/jpeg')).toBe(true)
    expect(service.isSupportedMimeType('image/png')).toBe(true)
    expect(service.isSupportedMimeType('image/tiff')).toBe(false)
    expect(service.isSupportedMimeType('application/pdf')).toBe(false)
  })

  it('combines several photos into ONE PDF with one page per photo', async () => {
    const pdf = await service.buildPhotoPdf({
      caseNumber: 'ACME-WDC-2026-0001',
      companyName: 'ACME Pharma',
      photos: [
        { buffer: PNG_1X1, filename: 'one.png', mimetype: 'image/png' },
        { buffer: PNG_1X1, filename: 'two.png', mimetype: 'image/png' },
        { buffer: PNG_1X1, filename: 'three.png', mimetype: 'image/png' },
      ],
    })
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    expect(pdf.toString('latin1')).toMatch(/\/Count 3/)
  })

  it('refuses an empty photo set', async () => {
    await expect(
      service.buildPhotoPdf({ caseNumber: 'X', companyName: 'Y', photos: [] }),
    ).rejects.toMatchObject({ response: { code: 'NO_PHOTOS' } })
  })

  it('reports a corrupt image as IMAGE_UNREADABLE instead of producing a blank page', async () => {
    await expect(
      service.buildPhotoPdf({
        caseNumber: 'X',
        companyName: 'Y',
        photos: [
          {
            buffer: Buffer.from('not an image at all'),
            filename: 'bad.png',
            mimetype: 'image/png',
          },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'IMAGE_UNREADABLE' } })
  })
})
