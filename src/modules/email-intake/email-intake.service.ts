import { BadRequestException, Injectable, Logger } from '@nestjs/common'

import { RlsService } from '../../common/rls/rls.service'
import { MailService } from '../auth/services/mail.service'
import { resolveDefaultReportType } from '../pv/default-report-type.util'
import { CreatePvCaseDto } from '../pv/dto/create-pv-case.dto'
import { PvCaseService } from '../pv/pv-case.service'
import { InboundEmailWebhookPayload } from './dto/inbound-email-webhook.dto'
import { extractCaseFields } from './email-extraction.util'

export interface RequestMeta {
  ip?: string
}

export type EmailIntakeOutcome = 'case_created' | 'follow_up_sent' | 'unrecognized_recipient'

export interface EmailIntakeResult {
  outcome: EmailIntakeOutcome
  referenceNumber?: string
}

/**
 * VigiCloud Stage 3.3 — the inbound-email side of multi-channel intake.
 * Resolves the owning tenant by matching the webhook's `to` address
 * against `Company.intakeEmailAddress` (Stage 3.2's
 * `generateIntakeEmailAddress()`), scripted-extracts the minimum
 * criteria from the body, and either creates a draft `Case` (via the
 * same `PvCaseService.createFromSystemChannel()` every unauthenticated
 * channel shares) or sends an automated follow-up requesting whatever's
 * missing — per the user's own framing, "if not available we send an
 * automated follow up email so that they reply again." A genuinely
 * unrecognized recipient (stale forward, address typo on the sender's
 * side) is not an error on our end — logged and dropped, not thrown,
 * since the webhook call itself was valid.
 */
@Injectable()
export class EmailIntakeService {
  private readonly logger = new Logger(EmailIntakeService.name)

  constructor(
    private readonly rls: RlsService,
    private readonly pvCaseService: PvCaseService,
    private readonly mailService: MailService,
  ) {}

  async processInboundEmail(
    payload: InboundEmailWebhookPayload,
    meta: RequestMeta,
  ): Promise<EmailIntakeResult> {
    const toAddress = normalizeToAddress(payload.data?.to)
    const fromAddress = normalizeFromAddress(payload.data?.from)
    if (!toAddress || !fromAddress) {
      throw new BadRequestException({
        code: 'INVALID_PAYLOAD',
        message: 'Inbound email payload is missing a recognizable "to" or "from" address',
      })
    }

    const company = await this.rls.runWithSystemAccess((tx) =>
      tx.company.findFirst({ where: { intakeEmailAddress: toAddress, status: 'active' } }),
    )

    if (!company) {
      this.logger.warn(`Inbound email addressed to an unrecognized intake address: ${toAddress}`)
      return { outcome: 'unrecognized_recipient' }
    }

    const bodyText = payload.data.text ?? stripHtml(payload.data.html ?? '')
    const extracted = extractCaseFields(bodyText)
    const subject = payload.data.subject ?? '(no subject)'

    if (extracted.missingFields.length > 0) {
      await this.mailService.sendCaseIntakeFollowUp(
        fromAddress,
        company.name,
        extracted.missingFields,
        subject,
      )
      return { outcome: 'follow_up_sent' }
    }

    const reportType = await this.rls.runWithSystemAccess((tx) => resolveDefaultReportType(tx))
    if (!reportType) {
      this.logger.error(
        `No PV report type configured — cannot create an email-sourced case for company ${company.id}`,
      )
      return { outcome: 'unrecognized_recipient' }
    }

    const today = new Date().toISOString().slice(0, 10)
    const dto: CreatePvCaseDto = {
      reportTypeId: reportType.id,
      countryOfOccurrenceId: company.homeCountryId,
      countryOfReportId: company.homeCountryId,
      awarenessDate: today,
      receivedDate: today,
      additionalInformation: `Received via inbound email — subject: "${subject}"`,
      reporter: {
        reporterType: extracted.reporterIsHealthcareProfessional
          ? 'healthcare_professional'
          : 'consumer',
        fullName: extracted.reporterName ?? fromAddress,
        email: fromAddress,
      },
      patient: {
        ageYears: extracted.patientAgeYears ?? undefined,
        sex: extracted.patientSex ?? undefined,
        initials: extracted.patientInitials ?? undefined,
      },
      suspectProducts: [
        { drugCharacterization: 'suspect', medicinalProduct: extracted.productName as string },
      ],
      adverseEvents: [
        { reportedTerm: extracted.eventTerm as string, narrative: extracted.narrative },
      ],
    }

    const created = await this.pvCaseService.createFromSystemChannel(
      company.id,
      dto,
      'drug_safety_email',
      payload.data.messageId ?? null,
      meta,
    )

    // Stage 3.3 — reply to the same address that emailed in, confirming
    // receipt with the real reference number (previously the only email
    // this flow ever sent back was the missing-fields follow-up above).
    await this.mailService.sendCaseReceivedConfirmation(
      fromAddress,
      company.name,
      created.referenceNumber,
    )

    return { outcome: 'case_created', referenceNumber: created.referenceNumber }
  }
}

function normalizeToAddress(to: string | string[] | undefined): string | null {
  if (!to) return null
  const first = Array.isArray(to) ? to[0] : to
  return extractAddress(first)
}

function normalizeFromAddress(
  from: string | { email?: string; name?: string } | undefined,
): string | null {
  if (!from) return null
  if (typeof from === 'string') return extractAddress(from)
  return from.email ? extractAddress(from.email) : null
}

/** Handles both a bare address and an RFC 5322 `"Display Name" <addr@host>` form. */
function extractAddress(raw: string): string | null {
  const angleMatch = raw.match(/<([^>]+)>/)
  const candidate = (angleMatch ? angleMatch[1] : raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim()
}
