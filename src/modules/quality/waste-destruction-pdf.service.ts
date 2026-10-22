import { BadRequestException, Injectable } from '@nestjs/common'
import PDFDocument from 'pdfkit'

/**
 * QualCloud Phase 1 Pass B (item B5) — converts a set of destruction-photo
 * images into ONE PDF (one image per page), server-side with pdfkit.
 *
 * pdfkit embeds JPEG and PNG natively; other formats are refused at the
 * controller with a clear 400 rather than silently producing a blank page.
 * Every `.text()` call pins explicit x/y and the image is placed at an
 * explicit position — pdfkit's ambient cursor otherwise leaks between calls
 * (the same bug class documented in CLAUDE.md for the other PDF services).
 */
export const DESTRUCTION_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const

export interface DestructionPhotoInput {
  buffer: Buffer
  filename: string
  mimetype: string
}

const MARGIN = 36
const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89 // A4
const HEADER_HEIGHT = 44

@Injectable()
export class WasteDestructionPdfService {
  isSupportedMimeType(mimetype: string): boolean {
    return (DESTRUCTION_PHOTO_MIME_TYPES as readonly string[]).includes(mimetype)
  }

  async buildPhotoPdf(input: {
    caseNumber: string
    companyName: string
    photos: DestructionPhotoInput[]
  }): Promise<Buffer> {
    if (input.photos.length === 0) {
      throw new BadRequestException({
        code: 'NO_PHOTOS',
        message: 'At least one photo is required',
      })
    }
    const contentWidth = PAGE_WIDTH - MARGIN * 2
    const contentHeight = PAGE_HEIGHT - MARGIN * 2 - HEADER_HEIGHT

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        autoFirstPage: false,
        info: {
          Title: `Destruction photos — ${input.caseNumber}`,
          Author: input.companyName,
          Subject:
            'Pharmaceutical waste destruction record (Pharmacy and Poisons (Pharmaceutical Waste Management) Rules, r.17)',
        },
      })
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', (err: Error) => reject(err))

      try {
        input.photos.forEach((photo, index) => {
          doc.addPage({ size: 'A4', margin: MARGIN })
          doc
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(`${input.companyName} — case ${input.caseNumber}`, MARGIN, MARGIN, {
              width: contentWidth,
              lineBreak: false,
              ellipsis: true,
            })
          doc
            .font('Helvetica')
            .fontSize(8)
            .text(
              `Destruction photo ${index + 1} of ${input.photos.length} — ${photo.filename}`,
              MARGIN,
              MARGIN + 16,
              { width: contentWidth, lineBreak: false, ellipsis: true },
            )
          doc.image(photo.buffer, MARGIN, MARGIN + HEADER_HEIGHT, {
            fit: [contentWidth, contentHeight],
            align: 'center',
            valign: 'center',
          })
        })
        doc.end()
      } catch (err) {
        // pdfkit throws synchronously on a corrupt or unsupported image; surface it as a clear 400.
        doc.end()
        reject(
          new BadRequestException({
            code: 'IMAGE_UNREADABLE',
            message: `One of the photos could not be read as a JPEG or PNG image (${(err as Error).message})`,
          }),
        )
      }
    })
  }
}
