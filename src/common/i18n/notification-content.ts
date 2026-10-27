import { SupportedLocale } from './locale'
import { t } from './notification-messages'

/**
 * Every distinct shape of in-app `Notification`/notification-email
 * content this app creates, across its ~19 real call sites. A call
 * site passes `type` + `params`; `NotificationsService.create()`
 * resolves the actual title/body in the recipient's own locale via
 * `resolveNotificationContent()` below, overriding whatever English
 * literal the call site also computed (kept, deliberately, as the
 * safety-net value used if `type` is ever omitted or unrecognized —
 * see that service's own doc comment).
 */
export type NotificationType =
  | 'reg_query_assigned'
  | 'reg_deadline_escalation'
  | 'post_market_obligation_overdue'
  | 'retention_due'
  | 'reg_query_reminder'
  | 'renewal_due'
  | 'licensing_facility'
  | 'licensing_personnel'
  | 'licensing_permit'
  | 'fee_overdue'
  | 'workflow_deadline_escalation'
  | 'supplier_review'
  | 'deviation_investigation'
  | 'critical_deviation_raised'
  | 'management_review_due'
  | 'quality_trend_detected'
  | 'draft_review_due'
  | 'follow_up_contact'
  | 'follow_up_closed'

export interface NotificationContent {
  title: string
  body: string
}

export type NotificationParams = Record<string, string | boolean | undefined>

function str(params: NotificationParams, key: string): string {
  const v = params[key]
  return typeof v === 'string' ? v : ''
}

function bool(params: NotificationParams, key: string): boolean {
  return params[key] === true
}

/** `params[key]`, or `undefined` if not a string — used where a value is genuinely optional (e.g. a not-yet-known due date). */
function optStr(params: NotificationParams, key: string): string | undefined {
  const v = params[key]
  return typeof v === 'string' ? v : undefined
}

export function resolveNotificationContent(
  type: NotificationType,
  locale: SupportedLocale,
  params: NotificationParams,
): NotificationContent {
  switch (type) {
    case 'reg_query_assigned': {
      const dueDate = optStr(params, 'dueDate')
      return {
        title: t(locale, 'regQueryAssigned.title'),
        body: dueDate
          ? t(locale, 'regQueryAssigned.bodyWithDeadline', { dueDate })
          : t(locale, 'regQueryAssigned.bodyNoDeadline'),
      }
    }

    case 'reg_deadline_escalation': {
      const overdue = bool(params, 'overdue')
      const recordTypeLabel = str(params, 'recordTypeLabel')
      const recordType = str(params, 'recordType')
      const recordId = str(params, 'recordId')
      const dueDate = str(params, 'dueDate')
      const threshold = str(params, 'threshold')
      const title = overdue
        ? t(locale, 'regDeadlineEscalation.titleBreached', { recordTypeLabel, recordType, dueDate })
        : t(locale, 'regDeadlineEscalation.titleApproaching', {
            recordTypeLabel,
            recordType,
            dueDate,
            threshold,
          })
      return {
        title,
        body: t(locale, 'escalationBody.recordSuffix', { title, recordType, recordId }),
      }
    }

    case 'post_market_obligation_overdue': {
      const obligationType = str(params, 'obligationType')
      const registrationNumber = str(params, 'registrationNumber')
      const dueDate = str(params, 'dueDate')
      const obligationId = str(params, 'obligationId')
      const title = t(locale, 'postMarketObligationOverdue.title', {
        obligationType,
        registrationNumber,
        dueDate,
      })
      return { title, body: t(locale, 'postMarketObligationOverdue.body', { title, obligationId }) }
    }

    case 'retention_due': {
      const year = str(params, 'year')
      const brandName = str(params, 'brandName')
      const registrationNumber = str(params, 'registrationNumber')
      const title = t(locale, 'retentionDue.title', { year, brandName, registrationNumber })
      return { title, body: t(locale, 'retentionDue.body', { title, year }) }
    }

    case 'reg_query_reminder': {
      const overdue = bool(params, 'overdue')
      const dueLabel = str(params, 'dueLabel')
      const queryPreview = str(params, 'queryPreview')
      return overdue
        ? {
            title: t(locale, 'regQueryReminder.titleOverdue', { dueLabel }),
            body: t(locale, 'regQueryReminder.bodyOverdue', { dueLabel, queryPreview }),
          }
        : {
            title: t(locale, 'regQueryReminder.titleDue', { dueLabel }),
            body: t(locale, 'regQueryReminder.bodyDue', { dueLabel, queryPreview }),
          }
    }

    case 'renewal_due': {
      const brandName = str(params, 'brandName')
      const registrationNumber = str(params, 'registrationNumber')
      const expiresOn = str(params, 'expiresOn')
      const title = t(locale, 'renewalDue.title', { brandName, registrationNumber, expiresOn })
      return { title, body: t(locale, 'renewalDue.body', { title }) }
    }

    case 'licensing_facility': {
      const overdue = bool(params, 'overdue')
      const name = str(params, 'name')
      const licenceNumber =
        optStr(params, 'licenceNumber') ?? t(locale, 'licensingEscalation.unnumbered')
      const dueDate = str(params, 'dueDate')
      const recordType = str(params, 'recordType')
      const recordId = str(params, 'recordId')
      const title = overdue
        ? t(locale, 'licensingFacilityExpired.title', { name, licenceNumber })
        : t(locale, 'licensingFacilityApproaching.title', { name, dueDate })
      return {
        title,
        body: t(locale, 'escalationBody.recordSuffix', { title, recordType, recordId }),
      }
    }

    case 'licensing_personnel': {
      const overdue = bool(params, 'overdue')
      const licenceType = str(params, 'licenceType')
      const licenceNumber =
        optStr(params, 'licenceNumber') ?? t(locale, 'licensingEscalation.unnumbered')
      const dueDate = str(params, 'dueDate')
      const recordType = str(params, 'recordType')
      const recordId = str(params, 'recordId')
      const title = overdue
        ? t(locale, 'licensingPersonnelExpired.title', { licenceType, licenceNumber })
        : t(locale, 'licensingPersonnelApproaching.title', { licenceType, licenceNumber, dueDate })
      return {
        title,
        body: t(locale, 'escalationBody.recordSuffix', { title, recordType, recordId }),
      }
    }

    case 'licensing_permit': {
      const overdue = bool(params, 'overdue')
      const permitType = str(params, 'permitType')
      const permitNumber =
        optStr(params, 'permitNumber') ?? t(locale, 'licensingEscalation.unnumbered')
      const dueDate = str(params, 'dueDate')
      const recordType = str(params, 'recordType')
      const recordId = str(params, 'recordId')
      const title = overdue
        ? t(locale, 'licensingPermitExpired.title', { permitType, permitNumber })
        : t(locale, 'licensingPermitApproaching.title', { permitType, permitNumber, dueDate })
      return {
        title,
        body: t(locale, 'escalationBody.recordSuffix', { title, recordType, recordId }),
      }
    }

    case 'fee_overdue': {
      const feeType = str(params, 'feeType')
      const currency = str(params, 'currency')
      const amount = str(params, 'amount')
      const dueDate = str(params, 'dueDate')
      const invoiceId = str(params, 'invoiceId')
      const title = t(locale, 'feeOverdue.title', { feeType, currency, amount, dueDate })
      return { title, body: t(locale, 'feeOverdue.body', { title, invoiceId }) }
    }

    case 'workflow_deadline_escalation': {
      const overdue = bool(params, 'overdue')
      const recordType = str(params, 'recordType')
      const recordId = str(params, 'recordId')
      const dueDate = str(params, 'dueDate')
      const threshold = str(params, 'threshold')
      const title = overdue
        ? t(locale, 'workflowDeadlineBreached.title', { recordType, dueDate })
        : t(locale, 'workflowDeadlineApproaching.title', { recordType, dueDate, threshold })
      return {
        title,
        body: t(locale, 'escalationBody.recordSuffix', { title, recordType, recordId }),
      }
    }

    case 'supplier_review': {
      const overdue = bool(params, 'overdue')
      const supplierName = str(params, 'supplierName')
      const dueDate = str(params, 'dueDate')
      return overdue
        ? {
            title: t(locale, 'supplierReviewOverdue.title', { supplierName }),
            body: t(locale, 'supplierReviewOverdue.body', { supplierName, dueDate }),
          }
        : {
            title: t(locale, 'supplierReviewDue.title', { supplierName }),
            body: t(locale, 'supplierReviewDue.body', { supplierName, dueDate }),
          }
    }

    case 'deviation_investigation': {
      const overdue = bool(params, 'overdue')
      const deviationNumber = str(params, 'deviationNumber')
      const deviationTitle = str(params, 'deviationTitle')
      const dueDate = str(params, 'dueDate')
      return overdue
        ? {
            title: t(locale, 'deviationInvestigationOverdue.title', { deviationNumber }),
            body: t(locale, 'deviationInvestigationOverdue.body', { deviationTitle, dueDate }),
          }
        : {
            title: t(locale, 'deviationInvestigationDue.title', { deviationNumber }),
            body: t(locale, 'deviationInvestigationDue.body', { deviationTitle, dueDate }),
          }
    }

    case 'critical_deviation_raised': {
      const deviationNumber = str(params, 'deviationNumber')
      const deviationTitle = str(params, 'deviationTitle')
      return {
        title: t(locale, 'criticalDeviationRaised.title', { deviationNumber }),
        body: t(locale, 'criticalDeviationRaised.body', { deviationTitle }),
      }
    }

    case 'management_review_due':
      return {
        title: t(locale, 'managementReviewDue.title'),
        body: t(locale, 'managementReviewDue.body'),
      }

    case 'quality_trend_detected': {
      const category = str(params, 'category')
      const capaCount = str(params, 'capaCount')
      const windowDays = str(params, 'windowDays')
      return {
        title: t(locale, 'qualityTrendDetected.title', { category }),
        body: t(locale, 'qualityTrendDetected.body', { category, capaCount, windowDays }),
      }
    }

    case 'draft_review_due': {
      const referenceNumber = str(params, 'referenceNumber')
      const claimed = bool(params, 'claimed')
      return {
        title: t(locale, 'draftReviewDue.title', { referenceNumber }),
        body: claimed
          ? t(locale, 'draftReviewDue.bodyClaimed')
          : t(locale, 'draftReviewDue.bodyUnclaimed'),
      }
    }

    case 'follow_up_contact': {
      const attemptNumber = str(params, 'attemptNumber')
      const referenceNumber = str(params, 'referenceNumber')
      const dueDate = str(params, 'dueDate')
      const reporterContact = str(params, 'reporterContact')
      const canEmail = bool(params, 'canEmail')
      const title = t(locale, 'followUpContactEmailed.title', {
        attemptNumber,
        referenceNumber,
        dueDate,
      })
      if (canEmail) {
        return {
          title,
          body: t(locale, 'followUpContactEmailed.body', {
            attemptNumber,
            referenceNumber,
            reporterContact,
            dueDate,
          }),
        }
      }
      const noConsent = bool(params, 'noConsent')
      const reasonLine = noConsent
        ? t(locale, 'followUpContactManual.noConsent')
        : t(locale, 'followUpContactManual.noEmail')
      return {
        title,
        body: t(locale, 'followUpContactManual.body', {
          attemptNumber,
          referenceNumber,
          reasonLine,
          reporterContact,
          dueDate,
        }),
      }
    }

    case 'follow_up_closed': {
      const resolved = bool(params, 'resolved')
      const reasonKey = str(params, 'reasonKey')
      const title = resolved
        ? t(locale, 'followUpClosed.titleResolved')
        : t(locale, 'followUpClosed.titleFailed')
      const body =
        reasonKey === 'responded'
          ? t(locale, 'followUpClosed.reasonResponded', {
              attemptNumber: str(params, 'attemptNumber'),
            })
          : reasonKey === 'noResponse'
            ? t(locale, 'followUpClosed.reasonNoResponse')
            : t(locale, 'followUpClosed.reasonCeiling')
      return { title, body }
    }
  }
}
