import { Injectable } from '@nestjs/common'
import * as QRCode from 'qrcode'

/**
 * VigiCloud Stage 3.2 — QR code generation for the per-company public
 * reporting URL, downloadable for print/business-card/educational-material
 * use. Not a special external dependency (see `needs.md` §7 — QR
 * *generation* is ordinary self-contained code, unlike the telephony/
 * email/WhatsApp integrations elsewhere in Stage 3): the `qrcode` package
 * is already a dependency, already used for MFA TOTP setup
 * (`MfaService`), reused here rather than adding a second QR library.
 */
@Injectable()
export class QrCodeService {
  /** A print-quality PNG buffer encoding `url`, ready to write directly to an HTTP response or a file. */
  async generatePng(url: string): Promise<Buffer> {
    return QRCode.toBuffer(url, { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' })
  }
}
